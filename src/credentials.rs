//! OS-protected credentials. Session JSON is never written as plaintext to a profile.
use anyhow::{Context, Result, bail};
use serde_json::Value;
use std::path::{Path, PathBuf};
pub struct Credentials {
    profile: PathBuf,
}
impl Credentials {
    pub fn new(profile: &Path) -> Self {
        Self {
            profile: profile.to_owned(),
        }
    }
    #[cfg(target_os = "linux")]
    fn command(&self, operation: &str) -> std::process::Command {
        let mut command = std::process::Command::new("secret-tool");
        command.arg(operation);
        if operation == "store" {
            command.arg("--label=Canvas Sidekick Rust session");
        }
        command
            .args(["service", "canvas-sidekick-rust", "profile"])
            .arg(&self.profile);
        command
    }
    #[cfg(target_os = "linux")]
    pub fn save(&self, session: &Value) -> Result<()> {
        use std::{io::Write, process::Stdio};
        let mut child = self
            .command("store")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .context("The native credential store requires secret-tool (libsecret)")?;
        child
            .stdin
            .take()
            .context("Credential input pipe unavailable")?
            .write_all(&serde_json::to_vec(session)?)?;
        let output = child.wait_with_output()?;
        if !output.status.success() {
            bail!("Could not store Canvas credentials; unlock the desktop keyring and retry");
        }
        Ok(())
    }
    #[cfg(target_os = "linux")]
    pub fn load(&self) -> Result<Option<Value>> {
        let output = self
            .command("lookup")
            .output()
            .context("The native credential store requires secret-tool (libsecret)")?;
        if output.status.success() {
            return Ok(Some(
                serde_json::from_slice(&output.stdout)
                    .context("Stored Canvas session is invalid")?,
            ));
        }
        if output.stdout.is_empty() && output.stderr.is_empty() {
            return Ok(None);
        }
        bail!("Could not read Canvas credentials; unlock the desktop keyring and retry")
    }
    #[cfg(target_os = "linux")]
    pub fn clear(&self) -> Result<()> {
        let output = self.command("clear").output()?;
        if !output.status.success() && !output.stderr.is_empty() {
            bail!("Could not remove the Canvas credential entry");
        }
        Ok(())
    }
    #[cfg(target_os = "windows")]
    pub fn save(&self, session: &Value) -> Result<()> {
        crate::storage::atomic_write(
            &self.profile.join("session.bin"),
            &windows::protect(&serde_json::to_vec(session)?, false)?,
        )
    }
    #[cfg(target_os = "windows")]
    pub fn load(&self) -> Result<Option<Value>> {
        match std::fs::read(self.profile.join("session.bin")) {
            Ok(bytes) => Ok(Some(serde_json::from_slice(&windows::protect(
                &bytes, true,
            )?)?)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.into()),
        }
    }
    #[cfg(target_os = "windows")]
    pub fn clear(&self) -> Result<()> {
        match std::fs::remove_file(self.profile.join("session.bin")) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}
#[cfg(target_os = "windows")]
mod windows {
    use anyhow::{Result, bail};
    use std::{ffi::c_void, ptr};
    #[repr(C)]
    struct Blob {
        len: u32,
        data: *mut u8,
    }
    #[link(name = "crypt32")]
    unsafe extern "system" {
        fn CryptProtectData(
            input: *const Blob,
            description: *const u16,
            entropy: *const Blob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            output: *mut Blob,
        ) -> i32;
        fn CryptUnprotectData(
            input: *const Blob,
            description: *mut *mut u16,
            entropy: *const Blob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            output: *mut Blob,
        ) -> i32;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn LocalFree(memory: *mut c_void) -> *mut c_void;
    }
    pub(super) fn protect(bytes: &[u8], decrypt: bool) -> Result<Vec<u8>> {
        let input = Blob {
            len: bytes.len().try_into()?,
            data: bytes.as_ptr().cast_mut(),
        };
        let mut output = Blob {
            len: 0,
            data: ptr::null_mut(),
        };
        // DPAPI binds this blob to the current Windows user, matching legacy safeStorage.
        let succeeded = unsafe {
            if decrypt {
                CryptUnprotectData(
                    &input,
                    ptr::null_mut(),
                    ptr::null(),
                    ptr::null_mut(),
                    ptr::null_mut(),
                    1,
                    &mut output,
                )
            } else {
                CryptProtectData(
                    &input,
                    ptr::null(),
                    ptr::null(),
                    ptr::null_mut(),
                    ptr::null_mut(),
                    1,
                    &mut output,
                )
            }
        };
        if succeeded == 0 {
            bail!("Windows could not protect or restore the Canvas session");
        }
        let result =
            unsafe { std::slice::from_raw_parts(output.data, output.len as usize).to_vec() };
        unsafe {
            LocalFree(output.data.cast());
        }
        Ok(result)
    }
}
