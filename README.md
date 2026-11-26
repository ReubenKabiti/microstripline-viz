# Microstrip Lab

Visualizes signals on demo microstrip traces of a 4-layer board (SIG / GND / VCC / SIG).

## Use
- Click a trace on the board (or its button) for the detailed view. Esc closes it.
- Space pauses, `.` steps by 1/20 of a period. Drag to rotate, wheel to zoom, right-drag to pan.
- For square, pulse or step signals at low frequency, raise "Screen time per period" to see edges travel.

## Model limits
1-D FDTD transmission lines; Hammerstad-Jensen Z0 (no solder mask); loss evaluated at the generator
frequency only; no dispersion, radiation, bend effects, crosstalk or vias. The cross-section view uses a
2-D finite-volume Laplace solve.

## Develop
    npm install
    npm test            # physics checks
    npm run dev         # browser, http://localhost:5173
    npm run tauri build # on Windows with Rust (MSVC) and C++ build tools (not tried in this setup)

The shipped binaries were cross-compiled on Linux for x86_64-pc-windows-gnu:

    npx tauri build --runner cargo --target x86_64-pc-windows-gnu -- -Z build-std=std,panic_abort

with RUSTC_BOOTSTRAP=1, Ubuntu's rustc-1.97 and rust-1.97-src, mingw-w64 and nsis. That needed two local
steps: compiling library/rtstartup/rsbegin.rs and rsend.rs into the target lib folder, and adding the
`windows-link` path dependency (`../windows_link`) under `cfg(windows)` in library/std/Cargo.toml.
