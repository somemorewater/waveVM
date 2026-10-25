#[cfg(not(unix))]
use std::path::Path;

#[cfg(not(unix))]
use serde_json::Value;

#[derive(Debug, thiserror::Error)]
pub enum QmpError {
    #[error("QMP socket I/O failed: {0}")]
    Io(#[from] std::io::Error),

    #[error("QMP protocol error: {0}")]
    Protocol(String),

    #[error("QMP command failed: {0}")]
    Command(String),

    #[cfg(not(unix))]
    #[error("QMP is not available on this platform")]
    Unsupported,
}

#[cfg(unix)]
mod platform {
    use std::io::{BufRead, BufReader, Write};
    use std::os::unix::net::UnixStream;
    use std::path::Path;
    use std::time::Duration;

    use serde_json::{json, Value};

    use super::QmpError;

    pub struct QmpClient {
        stream: UnixStream,
        reader: BufReader<UnixStream>,
    }

    impl QmpClient {
        pub fn connect(path: &Path) -> Result<Self, QmpError> {
            let stream = UnixStream::connect(path)?;
            stream.set_read_timeout(Some(Duration::from_secs(2)))?;
            stream.set_write_timeout(Some(Duration::from_secs(2)))?;

            let reader_stream = stream.try_clone()?;
            let mut reader = BufReader::new(reader_stream);
            let greeting = read_message(&mut reader)?;

            if greeting.get("QMP").is_none() {
                return Err(QmpError::Protocol(
                    "the endpoint did not send a QMP greeting".to_string(),
                ));
            }

            let mut client = Self { stream, reader };
            client.execute("qmp_capabilities", None)?;
            Ok(client)
        }

        pub fn execute(
            &mut self,
            command: &str,
            arguments: Option<Value>,
        ) -> Result<Value, QmpError> {
            let mut request = json!({ "execute": command });
            if let Some(arguments) = arguments {
                request["arguments"] = arguments;
            }

            let mut line = serde_json::to_string(&request)
                .map_err(|error| QmpError::Protocol(error.to_string()))?;
            line.push('\n');
            self.stream.write_all(line.as_bytes())?;
            self.stream.flush()?;

            loop {
                let message = read_message(&mut self.reader)?;

                if let Some(error) = message.get("error") {
                    let description = error
                        .get("desc")
                        .and_then(Value::as_str)
                        .unwrap_or("QEMU rejected the QMP command");
                    return Err(QmpError::Command(description.to_string()));
                }

                if let Some(result) = message.get("return") {
                    return Ok(result.clone());
                }

                // QMP events can arrive between a request and its response.
            }
        }
    }

    fn read_message(reader: &mut BufReader<UnixStream>) -> Result<Value, QmpError> {
        let mut line = String::new();
        let read = reader.read_line(&mut line)?;

        if read == 0 {
            return Err(QmpError::Protocol(
                "the QMP connection closed before a response was received".to_string(),
            ));
        }

        serde_json::from_str(line.trim()).map_err(|error| QmpError::Protocol(error.to_string()))
    }
}

#[cfg(unix)]
pub use platform::QmpClient;

#[cfg(not(unix))]
pub struct QmpClient;

#[cfg(not(unix))]
impl QmpClient {
    pub fn connect(_path: &Path) -> Result<Self, QmpError> {
        Err(QmpError::Unsupported)
    }

    pub fn execute(
        &mut self,
        _command: &str,
        _arguments: Option<Value>,
    ) -> Result<Value, QmpError> {
        Err(QmpError::Unsupported)
    }
}
