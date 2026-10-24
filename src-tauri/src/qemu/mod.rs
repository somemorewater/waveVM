mod discovery;
mod probe;

pub use discovery::{discover_qemu_img, discover_system_emulator};
pub use probe::{ToolInfo, ToolStatus};

pub fn system_emulator_name(arch: &str) -> Option<&'static str> {
    match arch {
        "x86_64" => Some("qemu-system-x86_64"),
        "x86" => Some("qemu-system-i386"),
        "aarch64" => Some("qemu-system-aarch64"),
        "arm" => Some("qemu-system-arm"),
        "riscv64" => Some("qemu-system-riscv64"),
        "powerpc64" => Some("qemu-system-ppc64"),
        "s390x" => Some("qemu-system-s390x"),
        "loongarch64" => Some("qemu-system-loongarch64"),
        "mips" => Some("qemu-system-mips"),
        "mips64" => Some("qemu-system-mips64"),
        "sparc64" => Some("qemu-system-sparc64"),
        _ => None,
    }
}
