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
- **Progress at a glance.** Every subject is a card with a progress bar and its percentage. Open a card to see how many classes you must attend to reach your target and how many you can miss and still stay above it.
- **Target slider.** A vertical slider in the side bar runs from 50% to 100% and snaps to marks every 5 points between 70% and 90% (default 85%). The selected value is shown above it. Drag it, tap a position, or use the arrow keys, Home and End.
- **Policy thresholds.** Every card also shows the numbers for two fixed reference thresholds (75% for exam eligibility and 85% for fine-free by default).
- **Colour-coded progress.** Red below the eligibility threshold, amber below your target, green once the target is met.
- **Status overview.** A ring icon in the side bar draws one dot per subject, coloured by its status. Selecting it lists the subjects that are below the eligibility threshold, below your target, or on target.
- **Import from the college portal.** Bring your attendance in with a bookmark or by pasting the portal's table (see below).
- **Add, edit, rename and delete** subjects, with a confirmation dialog for deletion.
- **Live validation.** The forms use the same validators as the core, so the rules cannot drift between C++ and JavaScript.
- **Keyboard shortcut.** Press `N` to add a subject.
- **Light and dark themes** that follow your system setting, with an accent gradient throughout.

## Side bar

From top to bottom: the target slider, then **Add subject**, **Attendance status**, **Import attendance** and **About**.

## Importing from the college portal

Open **Import attendance** in the side bar. There are two ways to bring data in.

**Bookmark (recommended)**

1. Open the Import dialog on the deployed site and create a bookmark whose address is the code shown there (use **Copy code**), or drag the link in the dialog to your bookmarks bar.
2. Log in to the portal and open the attendance page.
3. Open the bookmark. ACalc opens in a new tab with a preview of your subjects.

**Paste**

Select the attendance table on the portal, copy it, paste it into the box in the Import dialog and press **Preview**. This also works when a bookmark is blocked, for example on some phone browsers.

**Preview and import**

The preview lists every subject with its counts. Rows that fail validation are shown as skipped, with the reason. Choose whether to update matching subjects and add new ones, or to replace all current subjects, then confirm.

**What the importer expects**

- A table with **Subject**, **Conducted** and **Attended** columns, in any order. Other columns are ignored.
- Names such as `E0010 - Digital Signal Processing - EC3003-1 - Practical` are shortened to `Digital Signal Processing (Practical)`. Rows named "Total" are ignored.

**Privacy and safety**

- The bookmark only reads the table that is on screen. It never touches your password or cookies.
- The data travels in the part of the address after `#`, which browsers never send to a server, and ACalc removes it from the address bar after reading it.
- Nothing is imported until you confirm the preview, and names and numbers are displayed as plain text.
- The bookmark code points to the address of the page where you opened the dialog. Create it from the deployed site, not from `localhost`.

**Limitations**

- A portal can block bookmarks, or show the table inside a frame from another domain that a bookmark cannot read. In that case use paste.
- If the portal changes its table layout, the importer may need an update.

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

The site is static. To host it (for example on GitHub Pages), publish `index.html`, `style.css`, `app.js`, the `assets` folder and the two generated files in `build-wasm`.

## Project layout

```
.
├── CMakeLists.txt
├── src/
│   ├── core.h          # Attendance logic (header-only, C++23)
│   └── main.cpp        # Embind bindings
├── index.html
├── style.css
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
| Portal table parsing and name cleaning | `app.js` (`parseAttendanceRows`, `cleanSubjectName`) |
| Accent gradient | `style.css` (`--color-accent-start`, `--color-accent-end`) and the artwork in `assets` |

## Icons

Icons are standalone SVG files in `assets/icons`, applied through CSS in `style.css`:

| Icon | Kind |
| --- | --- |
| `add`, `delete`, `heart`, `heart-filled`, `import` | Carry their own colours (accent gradient or red) and are shown exactly as drawn |
| `edit`, `close`, `chevron-down` | Single colour: only the shape is used, and the colour follows the surrounding text |

The expander arrow is the single `chevron-down` icon, rotated when a card is open. To add an icon, drop the SVG into `assets/icons` and add a matching `.icon[data-icon="name"]` rule in `style.css`.

## Notes and limitations

- **Data is not saved.** Subjects live in memory and are lost when the page is reloaded.
- **Browser support.** The UI uses `<dialog>`, `color-mix()`, CSS masks and SVG favicons. Older Safari versions may not show the favicon.

## Author

Made with ♥ by Silicon Dioxide, [@silincone](https://github.com/silincone) on GitHub.
