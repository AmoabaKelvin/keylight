//! A local socket (one JSON message per connection, reply on one
//! line), so Karabiner's `keylight hyper on` and scripts reach the running app.

use crate::engine::Shared;
use serde_json::Value;
use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub fn socket_path() -> PathBuf {
    crate::data_dir().join("keylight.sock")
}

pub fn serve(engine: Shared) {
    let path = socket_path();
    if path.exists() {
        if UnixStream::connect(&path).is_ok() {
            eprintln!("keylight: another copy is already listening on {}", path.display());
            return;
        }
        let _ = std::fs::remove_file(&path);
    }
    let listener = match UnixListener::bind(&path) {
        Ok(l) => l,
        Err(e) => return eprintln!("keylight: can't listen on {}: {e}", path.display()),
    };
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let engine = engine.clone();
            std::thread::spawn(move || answer(stream, &engine));
        }
    });
}

fn answer(mut stream: UnixStream, engine: &Shared) {
    stream.set_read_timeout(Some(Duration::from_secs(1))).ok();
    let mut buf = Vec::new();
    let mut chunk = [0u8; 65536];
    let msg = loop {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => break serde_json::from_slice::<Value>(&buf).ok(),
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if let Ok(v) = serde_json::from_slice::<Value>(&buf) {
                    break Some(v);
                }
            }
        }
    };
    let reply = match msg {
        None => "error: not JSON".to_string(),
        Some(msg) => match engine.lock().unwrap().handle(&msg) {
            Ok(Value::Null) => "ok".to_string(),
            Ok(v) => v.to_string(),
            Err(e) => format!("error: {e}"),
        },
    };
    let _ = stream.write_all(format!("{reply}\n").as_bytes());
}

/// Client side, for the command-line mode.
pub fn send(path: &Path, msg: &str) -> Result<String, String> {
    let mut s = UnixStream::connect(path).map_err(|_| "Keylight isn't running".to_string())?;
    s.set_read_timeout(Some(Duration::from_secs(3))).ok();
    s.write_all(msg.as_bytes()).map_err(|e| e.to_string())?;
    let mut out = String::new();
    s.read_to_string(&mut out).map_err(|e| e.to_string())?;
    Ok(out.trim().to_string())
}
