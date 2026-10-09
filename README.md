<p align="center">
  <img src="icon.svg" alt="Attendance Calculator icon" width="96" height="96" />
</p>

<h1 align="center">Attendance Calculator</h1>

<p align="center">
  Track attendance per subject and see exactly how many classes you need to attend, or can afford to miss, to stay on target.
</p>

Attendance Calculator (ACalc) is a small web app. All the calculation logic is a header-only C++23 library compiled to WebAssembly with [Emscripten](https://emscripten.org/) and [Embind](https://emscripten.org/docs/porting/connecting_cpp_and_javascript/embind.html). The interface is plain HTML, CSS and JavaScript with no frameworks and no runtime dependencies.

## Features

- **Per-subject tracking.** Enter classes attended and classes conducted for each subject.
- **Clear answers.** For every subject you get the current percentage, the shortfall or surplus against your target, how many classes you must attend to reach it, and how many you can miss and still stay above it.
- **Adjustable target.** Choose any target from 70% to 90% (default 85%).
- **Policy thresholds.** Every subject also shows the numbers for two fixed reference thresholds (75% for exam eligibility and 85% for fine-free by default).
- **Colour-coded progress.** Red below the eligibility threshold, amber below your target, green once the target is met.
- **Add, edit, rename and delete** subjects, with a confirmation dialog for deletion.
- **Live validation.** The form uses the same validators as the core, so the rules cannot drift between C++ and JavaScript.
- **Keyboard shortcut.** Press `N` to add a subject.
- **Light and dark themes** that follow your system setting.

## Getting started

### Requirements

| Tool | Version |
| --- | --- |
| [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html) | Recent release bundling LLVM 17 or newer (needed for `<format>` and `<expected>`) |
| CMake | 3.20 or newer |
| Browser | Any current Chrome, Edge, Firefox or Safari |

### Build

```bash
emcmake cmake -S . -B build-wasm -DCMAKE_BUILD_TYPE=Release
cmake --build build-wasm
```

This produces `build-wasm/acalc.js` and `build-wasm/acalc.wasm`.

### Run

WebAssembly cannot be loaded from a `file://` URL, so serve the project folder over HTTP:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

## Project layout

```
.
├── CMakeLists.txt
├── src/
│   ├── core.h        # Attendance logic (header-only, C++23)
│   └── main.cpp      # Embind bindings
├── index.html
├── styles.css
├── app.js            # UI logic
├── icon.svg          # App icon and favicon
└── build-wasm/       # Generated: acalc.js, acalc.wasm
```

## How it works

The JavaScript only talks to `AttendanceRegister`. Subjects are read back as plain objects and every native handle is freed immediately, so nothing leaks.

### The maths

With `CA` classes attended, `CC` classes conducted and a target of `d` percent:

| Value | Formula |
| --- | --- |
| Current percentage | `CA × 100 / CC` |
| Classes to attend | `ceil((d × CC − 100 × CA) / (100 − d))` |
| Classes you can miss | `floor(100 × CA / d − CC)` |

"Classes to attend" assumes you attend every upcoming class. "Classes you can miss" assumes you attend none of the upcoming ones. Comparisons use the raw counts rather than rounded percentages, so a subject sitting exactly on the target is treated as meeting it.

### Rules enforced by the core

- Subject names are trimmed, must not be empty, and must be unique (case-sensitive).
- Classes conducted must be greater than zero, at most `MAX_CLASSES` (1000), and not less than classes attended.
- The target must be between 70% and 90%.
- `edit` validates everything before changing anything, so a failed edit never leaves a subject half-updated.

### Exposed API

**`AttendanceRegister`**

| Method | Description |
| --- | --- |
| `insert(name, attended, conducted)` | Add a subject |
| `edit(name, newName, attended, conducted)` | Update counts and optionally rename (pass the same name to keep it) |
| `remove(name)` | Delete a subject |
| `clear()` | Remove every subject |
| `subjects()` | Copy of the subject list |
| `metricsFor(name, target)` | Metrics for one subject at an arbitrary target |
| `setDesiredPercentage(value)` | Change the target for every subject |

**Free functions:** `validateSubjectName`, `validateClassesCount`, `validateDesiredPercentage`.

**Constants:** `DESIRED_PERCENTAGE`, `MIN_DESIRED_PERCENTAGE`, `MAX_DESIRED_PERCENTAGE`, `MAX_CLASSES`.

Operations return a plain `{ status, code, message }` object. `code` is one of:

| Code | Meaning |
| --- | --- |
| `CCZ` | Classes conducted is zero |
| `CAGCC` | Classes attended is greater than classes conducted |
| `ESN` | Empty subject name |
| `SAP` | Subject already present |
| `SNP` | Subject not present |
| `IDP` | Invalid desired percentage |
| `CCTL` | Classes count too large |

## Configuration

| What | Where |
| --- | --- |
| Target range, default target, class limit | `src/core.h` (`MIN_DESIRED_PERCENTAGE`, `MAX_DESIRED_PERCENTAGE`, `DESIRED_PERCENTAGE`, `MAX_CLASSES`). The UI reads these from the core, so there is nothing to change in JavaScript. |
| Policy thresholds and the red progress cut-off | `app.js` (`ELIGIBILITY_PERCENTAGE`, `FINE_FREE_PERCENTAGE`). Both must lie within the target range. |
| Accent gradient | `styles.css` (`--color-accent-start`, `--color-accent-end`) and `icon.svg` |

## Notes and limitations

- **Data is not saved.** Subjects live in memory and are lost when the page is reloaded.
- **Icons.** Button icons use the Segoe Fluent Icons font (with Segoe MDL2 Assets as a fallback), which ships with Windows 10 and 11. On other systems they appear as empty boxes unless you bundle the font or swap in SVG icons.
- **Browser support.** The UI uses `<dialog>`, `color-mix()` and SVG favicons. Older Safari versions may not show the favicon.

## Author

Made with ♥ by Silicon Dioxide, [@silincone](https://github.com/silincone) on GitHub.
