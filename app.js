"use strict";

/* ---------- Configuration ---------- */

/** Attendance below this percentage makes a subject's progress bar red. */
const ELIGIBILITY_PERCENTAGE = 75;
const FINE_FREE_PERCENTAGE = 85;

/**
 * Reference thresholds shown in every subject's details.
 * Each value must lie within the target range accepted by the core.
 */
const POLICY_THRESHOLDS = [
  { label: "Exam eligibility", value: ELIGIBILITY_PERCENTAGE },
  { label: "Fine-free", value: FINE_FREE_PERCENTAGE },
];

/* ---------- State and DOM references ---------- */

const state = {
  core: null,           // initialized WebAssembly module
  register: null,       // AttendanceRegister instance
  target: 0,            // current target attendance percentage
  targetOptions: [],    // percentages the slider can snap to, ascending
  draggingTarget: false,
  importItems: [],      // subjects waiting in the import preview
  subjects: [],         // plain-object snapshot of the register
  expanded: new Set(),  // names of subjects whose details are open
  editingName: null,    // subject being edited, or null when adding
  renaming: false,      // whether the name field is unlocked in the edit dialog
  deletingName: null,   // subject awaiting delete confirmation
};

const touched = { name: false, attended: false, conducted: false };

const $ = (id) => document.getElementById(id);
const dom = {
  startupError: $("startup-error"),
  list: $("subject-list"),
  targetValue: $("target-value"),
  slider: $("target-slider"),
  sliderRail: $("slider-rail"),
  sliderThumb: $("slider-thumb"),
  addButton: $("add-subject-button"),
  aboutButton: $("about-button"),
  aboutIcon: $("about-icon"),
  aboutDialog: $("about-dialog"),
  aboutEligibility: $("about-eligibility"),
  statusButton: $("status-button"),
  statusIcon: $("status-icon"),
  statusDialog: $("status-dialog"),
  statusContent: $("status-content"),
  importButton: $("import-button"),
  importDialog: $("import-dialog"),
  importSource: $("import-source"),
  importPreview: $("import-preview"),
  importText: $("import-text"),
  importError: $("import-error"),
  importPreviewButton: $("import-preview-button"),
  importBack: $("import-back"),
  importConfirm: $("import-confirm"),
  importSummary: $("import-summary"),
  importList: $("import-list"),
  bookmarkletCode: $("bookmarklet-code"),
  bookmarkletLink: $("bookmarklet-link"),
  copyBookmarklet: $("copy-bookmarklet"),

  subjectDialog: $("subject-dialog"),
  subjectForm: $("subject-form"),
  subjectTitle: $("subject-dialog-title"),
  name: $("subject-name"),
  renameButton: $("rename-button"),
  renameIcon: $("rename-icon"),
  attended: $("classes-attended"),
  conducted: $("classes-conducted"),
  nameError: $("subject-name-error"),
  countsError: $("subject-counts-error"),

  deleteDialog: $("delete-dialog"),
  deleteForm: $("delete-form"),
  deleteMessage: $("delete-message"),
  deleteError: $("delete-error"),

};

/* ---------- Helpers ---------- */

function createElement(tag, { className, text, attributes } = {}, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (attributes) {
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

/** Icons are standalone SVG files in assets/icons, applied through CSS (see styles.css). */
function setIcon(container, name) {
  container.dataset.icon = name;
}

const createIcon = (name, extraClass = "") =>
  createElement("span", {
    className: `icon ${extraClass}`.trim(),
    attributes: { "data-icon": name, "aria-hidden": "true" },
  });

const formatPercent = (value) => (Number.isFinite(value) ? `${value.toFixed(2)}%` : "–");

/** Compact form for the rail button, e.g. 85% or 72.5%. */
const formatTarget = (value) => `${Number(value.toFixed(2))}%`;

/** Normalizes an OperationResult or MetricsResult returned by the core. */
function toOutcome(result) {
  return { ok: result.status === true, code: result.code, message: result.message };
}

function hasErrorCode(outcome, codeName) {
  return outcome.code.value === state.core.ErrorCodes[codeName].value;
}

/** Decides which part of the subject form an error belongs to. */
function errorArea(outcome) {
  const nameErrors = ["ESN", "SAP", "SNP"];
  return nameErrors.some((codeName) => hasErrorCode(outcome, codeName)) ? "name" : "counts";
}

function showBanner(message) {
  dom.startupError.textContent = message;
  dom.startupError.hidden = false;
}

function progressStatus(subject) {
  if (subject.current < ELIGIBILITY_PERCENTAGE) return "critical";
  return subject.required === 0 ? "met" : "warning";
}

/** Copies everything the UI needs out of the core and releases every native handle. */
function readSubjects() {
  const vector = state.register.subjects();
  const subjects = [];
  try {
    for (let index = 0; index < vector.size(); index++) {
      const subject = vector.get(index);
      try {
        const name = subject.subjectName();
        subjects.push({
          name,
          attended: subject.classesAttended(),
          conducted: subject.classesConducted(),
          current: subject.currentPercentage(),
          required: subject.requiredPercentage(),
          excess: subject.excessPercentage(),
          needed: subject.classesNeeded(),
          overflow: subject.classOverflow(),
          thresholds: POLICY_THRESHOLDS.map((threshold) => {
            const result = state.register.metricsFor(name, threshold.value);
            return { ...threshold, metrics: result.status ? result.metrics : null };
          }),
        });
      } finally {
        subject.delete();
      }
    }
  } finally {
    vector.delete();
  }
  return subjects;
}

/* ---------- Rendering ---------- */

function refresh() {
  state.subjects = readSubjects();
  renderTarget();
  renderSubjects();
  renderStatusIcon();
}

function describeThreshold(metrics) {
  if (!metrics) return "–";
  if (metrics.classesNeeded > 0) return `Attend ${metrics.classesNeeded} more`;
  if (metrics.classesOverflow > 0) return `Can miss ${metrics.classesOverflow}`;
  return "Exactly at threshold";
}

function buildCard(subject, index) {
  const expanded = state.expanded.has(subject.name);
  const bodyId = `subject-details-${index}`;
  const width = Number.isFinite(subject.current) ? Math.min(100, Math.max(0, subject.current)) : 0;

  const fill = createElement("span", { className: "progress-fill" });
  fill.style.width = `${width}%`;

  const toggle = createElement(
    "button",
    {
      className: "card-toggle",
      attributes: {
        type: "button",
        "data-action": "toggle",
        "data-subject": subject.name,
        "aria-expanded": String(expanded),
        "aria-controls": bodyId,
      },
    },
    createElement(
      "span",
      { className: "card-title-row" },
      createElement("span", { className: "card-name", text: subject.name }),
      createIcon("chevron-down", "chevron"),
    ),
    createElement(
      "span",
      { className: "card-progress-row" },
      createElement("span", { className: "progress", attributes: { "aria-hidden": "true" } }, fill),
      createElement("span", { className: "progress-value", text: formatPercent(subject.current) }),
    ),
  );

  const actionButton = (action, iconName, label, variant = "") =>
    createElement(
      "button",
      {
        className: `icon-button icon-button-small ${variant}`.trim(),
        attributes: {
          type: "button",
          "data-action": action,
          "data-subject": subject.name,
          title: label,
          "aria-label": `${label}: ${subject.name}`,
        },
      },
      createIcon(iconName),
    );

  const row = (label, value) => [createElement("dt", { text: label }), createElement("dd", { text: value })];

  const countItem = (label, value) =>
    createElement("span", { className: "card-count" }, `${label}: `, createElement("strong", { text: String(value) }));

  const body = createElement(
    "div",
    { className: "card-body", attributes: { id: bodyId } },
    createElement("h3", { text: `Target outcomes (${formatTarget(state.target)})` }),
    createElement(
      "dl",
      {},
      ...row("Classes to attend", String(subject.needed)),
      ...row("Classes you can miss", String(subject.overflow)),
    ),
    createElement("h3", { text: "Policy thresholds" }),
    createElement(
      "dl",
      {},
      ...subject.thresholds.flatMap((threshold) =>
        row(`${threshold.label} (${threshold.value}%)`, describeThreshold(threshold.metrics)),
      ),
    ),
  );
  body.hidden = !expanded;

  const header = createElement(
    "div",
    { className: "card-header" },
    toggle,
    createElement(
      "div",
      { className: "card-footer" },
      createElement(
        "p",
        { className: "card-counts" },
        countItem("Attended", subject.attended),
        countItem("Conducted", subject.conducted),
      ),
      createElement(
        "div",
        { className: "card-buttons" },
        actionButton("edit", "edit", "Edit subject"),
        actionButton("delete", "delete", "Delete subject", "icon-button-danger"),
      ),
    ),
  );

  return createElement(
    "article",
    { className: `card status-${progressStatus(subject)}${expanded ? " expanded" : ""}` },
    header,
    body,
  );
}

function renderSubjects() {
  dom.list.replaceChildren();

  if (state.subjects.length === 0) {
    dom.list.append(
      createElement("p", { className: "empty-state", text: "No subjects yet. Use the + button to add one." }),
    );
    return;
  }

  state.subjects.forEach((subject, index) => dom.list.append(buildCard(subject, index)));
}

function toggleCard(button, subjectName) {
  const card = button.closest(".card");
  const body = card.querySelector(".card-body");
  const expanded = button.getAttribute("aria-expanded") !== "true";

  button.setAttribute("aria-expanded", String(expanded));
  card.classList.toggle("expanded", expanded);
  body.hidden = !expanded;

  if (expanded) state.expanded.add(subjectName);
  else state.expanded.delete(subjectName);
}

/* ---------- Subject form ---------- */

function clearSubjectErrors() {
  for (const element of [dom.nameError, dom.countsError]) {
    element.hidden = true;
    element.textContent = "";
  }
  for (const input of [dom.name, dom.attended, dom.conducted]) input.removeAttribute("aria-invalid");
}

function showSubjectError(area, message) {
  if (area === "name") {
    dom.nameError.textContent = message;
    dom.nameError.hidden = false;
    dom.name.setAttribute("aria-invalid", "true");
  } else {
    dom.countsError.textContent = message;
    dom.countsError.hidden = false;
    dom.attended.setAttribute("aria-invalid", "true");
    dom.conducted.setAttribute("aria-invalid", "true");
  }
}

/** Reads both count fields, rejecting anything that is not a whole, non-negative number. */
function readCounts() {
  const attended = dom.attended.valueAsNumber;
  const conducted = dom.conducted.valueAsNumber;
  const isWholeNumber = (value) => Number.isInteger(value) && value >= 0;

  if (!isWholeNumber(attended) || !isWholeNumber(conducted)) {
    return { error: "Enter whole numbers of 0 or more." };
  }
  return { attended, conducted };
}

/**
 * Runs the core validators and reports the first problem in each area.
 * Without `force`, a field is only checked once the user has interacted with it,
 * so a fresh form does not open with errors.
 * Returns true when everything that was checked is valid.
 */
function validateSubjectForm({ force = false } = {}) {
  clearSubjectErrors();
  let valid = true;

  if (force || touched.name) {
    const nameOutcome = toOutcome(state.core.validateSubjectName(dom.name.value));
    if (!nameOutcome.ok) {
      showSubjectError("name", nameOutcome.message);
      valid = false;
    }
  }

  if (force || (touched.attended && touched.conducted)) {
    const counts = readCounts();
    if (counts.error) {
      showSubjectError("counts", counts.error);
      valid = false;
    } else {
      // Values beyond the limit are clamped so the core reports "too large" instead of overflowing its integer type.
      const clamp = (value) => Math.min(value, state.core.MAX_CLASSES + 1);
      const countsOutcome = toOutcome(state.core.validateClassesCount(clamp(counts.attended), clamp(counts.conducted)));
      if (!countsOutcome.ok) {
        showSubjectError("counts", countsOutcome.message);
        valid = false;
      }
    }
  }

  return valid;
}

function updateRenameButton() {
  setIcon(dom.renameIcon, state.renaming ? "close" : "edit");
  const label = state.renaming ? "Cancel rename" : "Rename subject";
  dom.renameButton.title = label;
  dom.renameButton.setAttribute("aria-label", label);
}

function toggleRename() {
  if (!state.renaming) {
    state.renaming = true;
    dom.name.readOnly = false;
    updateRenameButton();
    dom.name.focus();
    dom.name.select();
    return;
  }

  // Cancel: restore the original name and lock the field again.
  state.renaming = false;
  dom.name.value = state.editingName;
  dom.name.readOnly = true;
  touched.name = false;
  updateRenameButton();
  validateSubjectForm();
}

function openSubjectDialog(subject) {
  state.editingName = subject ? subject.name : null;
  state.renaming = false;
  touched.name = touched.attended = touched.conducted = false;
  clearSubjectErrors();

  dom.subjectTitle.textContent = subject ? "Edit subject" : "Add subject";
  dom.name.value = subject ? subject.name : "";
  dom.name.readOnly = Boolean(subject); // locked until the user chooses to rename
  dom.renameButton.hidden = !subject;
  updateRenameButton();
  dom.attended.value = subject ? subject.attended : 0;
  dom.conducted.value = subject ? subject.conducted : 0;

  dom.subjectDialog.showModal();
  (subject ? dom.attended : dom.name).focus();
}

function handleSubjectSubmit(event) {
  event.preventDefault();
  if (!validateSubjectForm({ force: true })) return;

  const name = dom.name.value.trim();
  const { attended, conducted } = readCounts();
  const isEditing = state.editingName !== null;

  const outcome = toOutcome(
    isEditing
      ? state.register.edit(state.editingName, name, attended, conducted)
      : state.register.insert(name, attended, conducted),
  );

  if (!outcome.ok) {
    clearSubjectErrors();
    showSubjectError(errorArea(outcome), outcome.message);
    return;
  }

  // Keep the card open after a rename.
  if (isEditing && name !== state.editingName && state.expanded.delete(state.editingName)) {
    state.expanded.add(name);
  }

  dom.subjectDialog.close();
  refresh();
}

/* ---------- Delete dialog ---------- */

function openDeleteDialog(subject) {
  state.deletingName = subject.name;
  dom.deleteMessage.textContent = `Delete “${subject.name}”? This cannot be undone.`;
  dom.deleteError.hidden = true;
  dom.deleteError.textContent = "";
  dom.deleteDialog.showModal();
}

function handleDeleteSubmit(event) {
  event.preventDefault();

  const outcome = toOutcome(state.register.remove(state.deletingName));
  if (!outcome.ok) {
    dom.deleteError.textContent = outcome.message;
    dom.deleteError.hidden = false;
    return;
  }

  state.expanded.delete(state.deletingName);
  state.deletingName = null;
  dom.deleteDialog.close();
  refresh();
}

/* ---------- Target slider ---------- */

/** Spacing between the snap marks, in percentage points. */
const TARGET_STEP = 5;

/** The slider track runs from SLIDER_MIN percent at the bottom to SLIDER_MAX percent at the top. */
const SLIDER_MIN = 50;
const SLIDER_MAX = 100;
const toTrackPosition = (percentage) => ((percentage - SLIDER_MIN) / (SLIDER_MAX - SLIDER_MIN)) * 100;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function nearestTarget(value) {
  return state.targetOptions.reduce((best, option) =>
    Math.abs(option - value) < Math.abs(best - value) ? option : best,
  );
}

/** Draws the slider. While dragging, `position` can fall between two marks. */
function renderTarget(position = state.target) {
  dom.slider.style.setProperty("--position", String(toTrackPosition(position)));
  dom.targetValue.textContent = formatTarget(nearestTarget(position));
  dom.slider.setAttribute("aria-valuenow", String(state.target));
  dom.slider.setAttribute("aria-valuetext", formatTarget(state.target));
}

function commitTarget(value) {
  if (value === state.target) {
    renderTarget();
    return;
  }

  const outcome = toOutcome(state.register.setDesiredPercentage(value));
  if (!outcome.ok) {
    showBanner(outcome.message);
    renderTarget();
    return;
  }

  state.target = value;
  refresh();
}

/** Converts the pointer height into a percentage; the thumb only travels between the first and last mark. */
function targetFromPointer(event) {
  const rect = dom.sliderRail.getBoundingClientRect();
  const fraction = 1 - (event.clientY - rect.top) / rect.height;
  const percentage = SLIDER_MIN + fraction * (SLIDER_MAX - SLIDER_MIN);
  return clamp(percentage, state.targetOptions[0], state.targetOptions.at(-1));
}

function handleSliderKeydown(event) {
  const last = state.targetOptions.length - 1;
  const index = state.targetOptions.indexOf(state.target);
  let next;

  switch (event.key) {
    case "ArrowUp":
    case "ArrowRight":
    case "PageUp":
      next = index + 1;
      break;
    case "ArrowDown":
    case "ArrowLeft":
    case "PageDown":
      next = index - 1;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = last;
      break;
    default:
      return;
  }

  event.preventDefault();
  commitTarget(state.targetOptions[clamp(next, 0, last)]);
}

function bindTargetSlider() {
  const stopDragging = () => {
    state.draggingTarget = false;
    dom.slider.classList.remove("is-dragging");
  };

  dom.slider.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    dom.slider.setPointerCapture(event.pointerId);
    dom.slider.focus();
    state.draggingTarget = true;
    dom.slider.classList.add("is-dragging");
    renderTarget(targetFromPointer(event));
  });

  dom.slider.addEventListener("pointermove", (event) => {
    if (state.draggingTarget) renderTarget(targetFromPointer(event));
  });

  dom.slider.addEventListener("pointerup", (event) => {
    if (!state.draggingTarget) return;
    stopDragging();
    commitTarget(nearestTarget(targetFromPointer(event)));
  });

  dom.slider.addEventListener("pointercancel", () => {
    stopDragging();
    renderTarget();
  });

  dom.slider.addEventListener("keydown", handleSliderKeydown);
}

/** Builds the snap marks from the core's allowed range and picks the starting target. */
function initializeTarget() {
  const { MIN_DESIRED_PERCENTAGE, MAX_DESIRED_PERCENTAGE, DESIRED_PERCENTAGE } = state.core;

  state.targetOptions = [];
  for (let value = MIN_DESIRED_PERCENTAGE; value <= MAX_DESIRED_PERCENTAGE; value += TARGET_STEP) {
    state.targetOptions.push(value);
  }

  for (const option of state.targetOptions) {
    const mark = createElement("span", { className: "slider-mark" });
    mark.style.setProperty("--position", String(toTrackPosition(option)));
    dom.sliderRail.insertBefore(mark, dom.sliderThumb);
  }

  dom.slider.setAttribute("aria-valuemin", String(state.targetOptions[0]));
  dom.slider.setAttribute("aria-valuemax", String(state.targetOptions.at(-1)));
  dom.slider.removeAttribute("aria-disabled");
  dom.slider.classList.remove("is-disabled");

  state.target = nearestTarget(DESIRED_PERCENTAGE);
  if (state.target !== DESIRED_PERCENTAGE) {
    toOutcome(state.register.setDesiredPercentage(state.target));
  }
}

/* ---------- Attendance status ---------- */

const SVG_NS = "http://www.w3.org/2000/svg";

const STATUS_GROUPS = [
  { status: "critical", label: () => `Below ${ELIGIBILITY_PERCENTAGE}%` },
  { status: "warning", label: () => `Below your ${formatTarget(state.target)} target` },
  { status: "met", label: () => "Target reached" },
];

const countByStatus = () =>
  Object.fromEntries(STATUS_GROUPS.map(({ status }) => [status, state.subjects.filter((s) => progressStatus(s) === status).length]));

/** Draws a ring with one dot per subject, colored by that subject's status. */
function renderStatusIcon() {
  const count = state.subjects.length;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "status-icon");
  svg.setAttribute("focusable", "false");

  const ringRadius = 9;
  if (count === 0) {
    const ring = document.createElementNS(SVG_NS, "circle");
    ring.setAttribute("class", "status-empty");
    ring.setAttribute("cx", "12");
    ring.setAttribute("cy", "12");
    ring.setAttribute("r", String(ringRadius));
    svg.append(ring);
  } else {
    const dotRadius = clamp(((2 * Math.PI * ringRadius) / count) * 0.38, 0.8, 2.4);
    state.subjects.forEach((subject, index) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / count; // first dot at the top, clockwise
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("class", `dot dot-${progressStatus(subject)}`);
      dot.setAttribute("cx", (12 + ringRadius * Math.cos(angle)).toFixed(2));
      dot.setAttribute("cy", (12 + ringRadius * Math.sin(angle)).toFixed(2));
      dot.setAttribute("r", dotRadius.toFixed(2));
      svg.append(dot);
    });
  }
  dom.statusIcon.replaceChildren(svg);

  const counts = countByStatus();
  dom.statusButton.setAttribute(
    "aria-label",
    count === 0
      ? "Attendance status: no subjects"
      : `Attendance status: ${counts.critical} below ${ELIGIBILITY_PERCENTAGE}%, ${counts.warning} below target, ${counts.met} on target`,
  );
}

function openStatusDialog() {
  dom.statusContent.replaceChildren();

  if (state.subjects.length === 0) {
    dom.statusContent.append(createElement("p", { className: "empty-state", text: "No subjects yet." }));
  } else {
    const total = state.subjects.length;
    dom.statusContent.append(createElement("p", { className: "status-total", text: `${total} ${total === 1 ? "subject" : "subjects"}` }));

    for (const group of STATUS_GROUPS) {
      const names = state.subjects.filter((subject) => progressStatus(subject) === group.status).map((subject) => subject.name);
      dom.statusContent.append(
        createElement(
          "div",
          { className: "status-row" },
          createElement("span", { className: `status-dot dot-${group.status}` }),
          createElement("span", { className: "status-label", text: group.label() }),
          createElement("strong", { className: "status-count", text: String(names.length) }),
        ),
      );
      if (names.length > 0) {
        dom.statusContent.append(createElement("ul", { className: "status-names" }, ...names.map((name) => createElement("li", { text: name }))));
      }
    }
  }

  dom.statusDialog.showModal();
}

/* ---------- Import from the portal ---------- */

const MAX_IMPORT_ROWS = 200;

/**
 * Runs on the portal page as a bookmarklet. It is converted to text, so it must stay
 * self-contained, end every statement with a semicolon and contain no line comments.
 * It finds the attendance table and opens ACalc with the table's rows.
 */
function readAttendanceTable(importUrl) {
  const documents = [document];
  document.querySelectorAll("iframe, frame").forEach((frame) => {
    try {
      if (frame.contentDocument) documents.push(frame.contentDocument);
    } catch (error) {
      return;
    }
  });
  const cleanText = (cell) => cell.textContent.replace(/\s+/g, " ").trim();
  for (const doc of documents) {
    for (const table of doc.querySelectorAll("table")) {
      const rows = [...table.rows].map((row) => [...row.cells].map(cleanText));
      const hasHeader = rows.some((row) =>
        ["subject", "conducted", "attended"].every((word) => row.some((cell) => cell.toLowerCase().includes(word))),
      );
      if (!hasHeader) continue;
      const json = JSON.stringify(rows);
      const encoded = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const link = importUrl + "#import=" + encoded;
      if (!window.open(link, "_blank")) window.location.href = link;
      return;
    }
  }
  alert("ACalc could not find the attendance table. Open the attendance page first.");
}

function buildBookmarklet() {
  const importUrl = `${window.location.origin}${window.location.pathname}`;
  const source = `(${readAttendanceTable.toString()})(${JSON.stringify(importUrl)});`;
  return `javascript:${source.replace(/\s*\n\s*/g, " ")}`;
}

/** Turns "E0010 - Digital Signal Processing - EC3003-1 - Practical" into "Digital Signal Processing (Practical)". */
function cleanSubjectName(rawName) {
  const parts = rawName.split(" - ").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3 || !/^[A-Za-z]\d+$/.test(parts[0])) return rawName.trim();

  const suffix = parts.slice(3).join(" ");
  return suffix ? `${parts[1]} (${suffix})` : parts[1];
}

/** Reads the rows of the portal table: finds the header, then one subject per row. */
function parseAttendanceRows(rows) {
  const columns = ["subject", "conducted", "attended"];
  const includesWord = (cell, word) => cell.toLowerCase().includes(word);
  const headerIndex = rows.findIndex((row) => columns.every((word) => row.some((cell) => includesWord(cell, word))));
  if (headerIndex === -1) {
    return { error: "No attendance table was found. The data needs Subject, Conducted and Attended columns." };
  }

  const header = rows[headerIndex];
  const [subjectColumn, conductedColumn, attendedColumn] = columns.map((word) =>
    header.findIndex((cell) => includesWord(cell, word)),
  );

  const items = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const rawName = (row[subjectColumn] ?? "").trim();
    const conducted = Number.parseInt(row[conductedColumn], 10);
    const attended = Number.parseInt(row[attendedColumn], 10);
    if (!rawName || /^total/i.test(rawName) || Number.isNaN(conducted) || Number.isNaN(attended)) continue;
    items.push({ rawName, name: cleanSubjectName(rawName), attended, conducted });
  }

  // If two cleaned names collide, fall back to the full portal name for those subjects.
  const nameCounts = new Map();
  for (const item of items) nameCounts.set(item.name, (nameCounts.get(item.name) ?? 0) + 1);
  for (const item of items) {
    if (nameCounts.get(item.name) > 1) item.name = item.rawName;
  }

  if (items.length === 0) return { error: "The table has no subject rows with class counts." };
  return { items };
}

/** Rows copied from a web page arrive tab-separated, one row per line. */
function parsePastedText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(line.includes("\t") ? "\t" : /\s{2,}/).map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean));
}

/** Decodes the rows sent by the bookmarklet. The link can come from anyone, so the shape is checked. */
function decodeImportPayload(encoded) {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const rows = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))));

  const isValid =
    Array.isArray(rows) &&
    rows.length <= MAX_IMPORT_ROWS &&
    rows.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === "string"));
  if (!isValid) throw new Error("Unexpected import data.");
  return rows;
}

/** Returns a reason to skip the item, or null when it can be imported. */
function checkImportItem(item) {
  if (item.attended < 0 || item.conducted < 0) return "Class counts cannot be negative.";

  const nameOutcome = toOutcome(state.core.validateSubjectName(item.name));
  if (!nameOutcome.ok) return nameOutcome.message;

  const clampCount = (value) => Math.min(value, state.core.MAX_CLASSES + 1);
  const countsOutcome = toOutcome(state.core.validateClassesCount(clampCount(item.attended), clampCount(item.conducted)));
  return countsOutcome.ok ? null : countsOutcome.message;
}

function showImportStep(step) {
  dom.importSource.hidden = step !== "source";
  dom.importPreview.hidden = step !== "preview";
}

function showImportError(message) {
  dom.importError.textContent = message;
  dom.importError.hidden = false;
}

function openImportDialog() {
  dom.importError.hidden = true;
  dom.importText.value = "";
  dom.bookmarkletCode.value = buildBookmarklet();
  dom.bookmarkletLink.href = dom.bookmarkletCode.value;
  showImportStep("source");
  dom.importDialog.showModal();
}

function buildImportRow(item) {
  return createElement(
    "li",
    { className: item.problem ? "import-row has-problem" : "import-row" },
    createElement("span", { className: "import-name", text: item.name }),
    createElement("span", { className: "import-counts", text: `${item.attended} / ${item.conducted}` }),
    ...(item.problem ? [createElement("span", { className: "import-problem", text: `Skipped: ${item.problem}` })] : []),
  );
}

function showImportPreview(items) {
  state.importItems = items.map((item) => ({ ...item, problem: checkImportItem(item) }));
  const ready = state.importItems.filter((item) => !item.problem).length;

  dom.importSummary.textContent = `${ready} of ${state.importItems.length} subjects are ready to import.`;
  dom.importList.replaceChildren(...state.importItems.map(buildImportRow));
  dom.importConfirm.disabled = ready === 0;

  showImportStep("preview");
  if (!dom.importDialog.open) dom.importDialog.showModal();
}

function handleImportPreview() {
  dom.importError.hidden = true;
  const parsed = parseAttendanceRows(parsePastedText(dom.importText.value));
  if (parsed.error) {
    showImportError(parsed.error);
    return;
  }
  showImportPreview(parsed.items);
}

function handleImportConfirm() {
  const mode = document.querySelector('input[name="import-mode"]:checked').value;
  const existingNames = new Set(state.subjects.map((subject) => subject.name));

  if (mode === "replace") {
    state.register.clear();
    state.expanded.clear();
    existingNames.clear();
  }

  const failures = [];
  for (const item of state.importItems.filter((entry) => !entry.problem)) {
    const outcome = toOutcome(
      existingNames.has(item.name)
        ? state.register.edit(item.name, item.name, item.attended, item.conducted)
        : state.register.insert(item.name, item.attended, item.conducted),
    );
    if (!outcome.ok) failures.push(`${item.name}: ${outcome.message}`);
  }

  dom.importDialog.close();
  refresh();
  if (failures.length > 0) showBanner(`Some subjects could not be imported. ${failures.join(" ")}`);
}

async function copyBookmarklet() {
  try {
    await navigator.clipboard.writeText(dom.bookmarkletCode.value);
    dom.copyBookmarklet.textContent = "Copied";
    setTimeout(() => {
      dom.copyBookmarklet.textContent = "Copy code";
    }, 1500);
  } catch {
    dom.bookmarkletCode.select();
  }
}

/** Handles the link opened by the bookmarklet, then removes the data from the address bar. */
function importFromHash() {
  const prefix = "#import=";
  if (!window.location.hash.startsWith(prefix)) return;

  const encoded = window.location.hash.slice(prefix.length);
  window.history.replaceState(null, "", window.location.pathname + window.location.search);

  let parsed;
  try {
    parsed = parseAttendanceRows(decodeImportPayload(encoded));
  } catch {
    parsed = { error: "The import link could not be read." };
  }

  if (parsed.error) {
    openImportDialog();
    showImportError(parsed.error);
    return;
  }
  showImportPreview(parsed.items);
}

/* ---------- Setup ---------- */

/** Wiring that does not depend on the WebAssembly module. */
function bindStaticEvents() {
  dom.aboutEligibility.textContent = `${ELIGIBILITY_PERCENTAGE}%`;

  dom.aboutButton.addEventListener("click", () => {
    setIcon(dom.aboutIcon, "heart-filled");
    dom.aboutDialog.showModal();
  });
  dom.aboutDialog.addEventListener("close", () => {
    setIcon(dom.aboutIcon, "heart");
  });

  for (const button of document.querySelectorAll("[data-close-dialog]")) {
    button.addEventListener("click", () => button.closest("dialog").close());
  }
}

function configureInputs() {
  const { MAX_CLASSES } = state.core;

  dom.attended.max = MAX_CLASSES;
  dom.conducted.max = MAX_CLASSES;
}

function bindApplicationEvents() {
  dom.addButton.addEventListener("click", () => openSubjectDialog(null));
  bindTargetSlider();
  dom.renameButton.addEventListener("click", toggleRename);
  dom.statusButton.addEventListener("click", openStatusDialog);

  dom.importButton.addEventListener("click", openImportDialog);
  dom.importPreviewButton.addEventListener("click", handleImportPreview);
  dom.importBack.addEventListener("click", () => showImportStep("source"));
  dom.importConfirm.addEventListener("click", handleImportConfirm);
  dom.copyBookmarklet.addEventListener("click", copyBookmarklet);
  dom.bookmarkletCode.addEventListener("focus", () => dom.bookmarkletCode.select());
  dom.bookmarkletLink.addEventListener("click", (event) => event.preventDefault());

  // Keyboard shortcut: N opens "Add subject" unless the user is typing or a dialog is open.
  document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "n" || event.repeat) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (dom.addButton.disabled || document.querySelector("dialog[open]")) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) return;

    event.preventDefault();
    openSubjectDialog(null);
  });

  dom.subjectForm.addEventListener("submit", handleSubjectSubmit);
  dom.deleteForm.addEventListener("submit", handleDeleteSubmit);

  dom.name.addEventListener("input", () => {
    touched.name = true;
    validateSubjectForm();
  });
  for (const [input, key] of [[dom.attended, "attended"], [dom.conducted, "conducted"]]) {
    input.addEventListener("input", () => {
      touched[key] = true;
      validateSubjectForm();
    });
  }

  dom.list.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const name = button.dataset.subject;
    if (button.dataset.action === "toggle") {
      toggleCard(button, name);
      return;
    }

    const subject = state.subjects.find((item) => item.name === name);
    if (!subject) return;

    if (button.dataset.action === "edit") openSubjectDialog(subject);
    else openDeleteDialog(subject);
  });
}

async function initialize() {
  bindStaticEvents();

  try {
    if (typeof ACalcModule !== "function") {
      throw new Error("The WebAssembly module was not found. Check that build-wasm/acalc.js loaded.");
    }

    state.core = await ACalcModule();
    state.register = new state.core.AttendanceRegister();
    initializeTarget();

    configureInputs();
    bindApplicationEvents();
    dom.addButton.disabled = false;
    dom.statusButton.disabled = false;
    dom.importButton.disabled = false;
    refresh();
    importFromHash();
  } catch (error) {
    console.error("Initialization failed:", error);
    showBanner(`The application could not start: ${error.message}`);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
