<p align="center">
  <img src="assets/acalc.svg" alt="ACalc icon" width="96" height="96" />
</p>

<h1 align="center">ACalc</h1>

<p align="center">
  <strong>Attendance Calculator</strong><br />
  Track attendance per subject and see exactly how many classes you need to attend, or can afford to miss, to stay on target.
</p>

ACalc is a small web app. All the calculation logic is a header-only C++23 library compiled to WebAssembly with [Emscripten](https://emscripten.org/) and [Embind](https://emscripten.org/docs/porting/connecting_cpp_and_javascript/embind.html). The interface is plain HTML, CSS and JavaScript with no frameworks and no runtime dependencies.

## Features

- **Per-subject tracking.** Enter classes attended and classes conducted for each subject.
- **Clear answers.** For every subject you get the current percentage, the shortfall or surplus against your target, how many classes you must attend to reach it, and how many you can miss and still stay above it.
- **Target slider.** A vertical slider in the side bar runs from 50% to 100% and snaps to marks every 5 points between 70% and 90% (default 85%). The selected value is shown above it, level with the "Target percentage:" label in the title bar. Drag it, tap a position, or use the arrow keys, Home and End.
- **Status overview.** A ring icon in the side bar draws one dot per subject, coloured by its status (red, amber or green). Selecting it shows how many subjects are below the eligibility threshold, below your target, or on target, with their names.
- **Policy thresholds.** Every subject also shows the numbers for two fixed reference thresholds (75% for exam eligibility and 85% for fine-free by default).
- **Colour-coded progress.** Red below the eligibility threshold, amber below your target, green once the target is met.
- **Add, edit, rename and delete** subjects, with a confirmation dialog for deletion.
- **Live validation.** The form uses the same validators as the core, so the rules cannot drift between C++ and JavaScript.
- **Keyboard shortcut.** Press `N` to add a subject.
- **Light and dark themes** that follow your system setting, with an accent gradient throughout.

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

WebAssembly and the SVG icons cannot be loaded from a `file://` URL, so serve the project folder over HTTP:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

### Deploy

The site is static. To host it (for example on GitHub Pages), publish `index.html`, `styles.css`, `app.js`, the `assets` folder and the two generated files in `build-wasm`.

## Project layout

```
.
├── CMakeLists.txt
├── src/
│   ├── core.h          # Attendance logic (header-only, C++23)
│   └── main.cpp        # Embind bindings
├── index.html
├── styles.css
├── app.js              # UI logic
├── assets/
│   ├── acalc.svg       # App icon and favicon
│   └── icons/          # UI icons (SVG)
└── build-wasm/         # Generated: acalc.js, acalc.wasm
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
| Target range, default target, class limit | `src/core.h` (`MIN_DESIRED_PERCENTAGE`, `MAX_DESIRED_PERCENTAGE`, `DESIRED_PERCENTAGE`, `MAX_CLASSES`). The UI reads these from the core. |
| Slider snap marks and track range | Marks are built from the core's target range in steps of `TARGET_STEP` (5); the track spans `SLIDER_MIN` (50) to `SLIDER_MAX` (100). Both are in `app.js`. |
| Policy thresholds and the red progress cut-off | `app.js` (`ELIGIBILITY_PERCENTAGE`, `FINE_FREE_PERCENTAGE`). Both must lie within the target range. |
| Accent gradient | `styles.css` (`--color-accent-start`, `--color-accent-end`) and the artwork in `assets` |

## Icons

Icons are standalone SVG files in `assets/icons`, applied through CSS in `styles.css`:

| Icon | Kind |
| --- | --- |
| `add`, `delete`, `heart`, `heart-filled` | Carry their own colours (accent gradient or red) and are shown exactly as drawn |
| `edit`, `close`, `chevron-down` | Single colour: only the shape is used, and the colour follows the surrounding text |

The expander arrow is the single `chevron-down` icon, rotated when a card is open. To add an icon, drop the SVG into `assets/icons` and add a matching `.icon[data-icon="name"]` rule in `styles.css`.

## Notes and limitations

- **Data is not saved.** Subjects live in memory and are lost when the page is reloaded.
- **Browser support.** The UI uses `<dialog>`, `color-mix()`, CSS masks and SVG favicons. Older Safari versions may not show the favicon.

## Author

Made with ♥ by Silicon Dioxide, [@silincone](https://github.com/silincone) on GitHub.
