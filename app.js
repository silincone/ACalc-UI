"use strict";

/**
 * Reference thresholds shown in every subject's details.
 * Each value must lie within the target range accepted by the core.
 */
const POLICY_THRESHOLDS = [
  { label: "Exam eligibility", value: 75 },
  { label: "Fine-free", value: 85 },
];

const state = {
  core: null,          // initialized WebAssembly module
  register: null,      // AttendanceRegister instance
  target: 0,           // current target attendance percentage
  subjects: [],        // plain-object snapshot of the register
  editingName: null,   // name of the subject being edited, or null when adding
};

const touched = { name: false, attended: false, conducted: false };

const $ = (id) => document.getElementById(id);
const dom = {
  startupError: $("startup-error"),
  summary: $("attendance-summary"),
  tableBody: $("subject-table-body"),
  targetButton: $("target-button"),
  targetValue: $("target-value"),
  addButton: $("add-subject-button"),

  subjectDialog: $("subject-dialog"),
  subjectForm: $("subject-form"),
  subjectTitle: $("subject-dialog-title"),
  name: $("subject-name"),
  renameButton: $("rename-button"),
  attended: $("classes-attended"),
  conducted: $("classes-conducted"),
  nameError: $("subject-name-error"),
  countsError: $("subject-counts-error"),

  targetDialog: $("target-dialog"),
  targetForm: $("target-form"),
  targetInput: $("target-input"),
  targetHint: $("target-hint"),
  targetError: $("target-error"),
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

const formatPercent = (value) => (Number.isFinite(value) ? `${value.toFixed(2)}%` : "–");

const formatTarget = (value) =>
  `${value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;

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
  dom.targetValue.textContent = formatTarget(state.target);
  renderSummary();
  renderTable();
}

function describeThreshold(metrics) {
  if (!metrics) return "-";
  if (metrics.classesNeeded > 0) return `Attend ${metrics.classesNeeded} more`;
  if (metrics.classesOverflow > 0) return `Can miss ${metrics.classesOverflow}`;
  return "Exactly at threshold";
}

function renderSummary() {
  dom.summary.replaceChildren();

  if (state.subjects.length === 0) {
    dom.summary.append(
      createElement("p", { className: "empty-state", text: "Add a subject to compare your attendance with the target." }),
    );
    return;
  }

  const row = (label, value) => [createElement("dt", { text: label }), createElement("dd", { text: value })];

  for (const subject of state.subjects) {
    const width = Number.isFinite(subject.current) ? Math.min(100, Math.max(0, subject.current)) : 0;
    const progressFill = createElement("span");
    progressFill.style.width = `${width}%`;

    const card = createElement(
      "details",
      { className: subject.required === 0 ? "card target-met" : "card" },
      createElement(
        "summary",
        {},
        createElement("span", { className: "card-name", text: subject.name }),
        createElement("span", { className: "card-percentage", text: formatPercent(subject.current) }),
        createElement("span", { className: "progress", attributes: { "aria-hidden": "true" } }, progressFill),
      ),
      createElement(
        "div",
        { className: "card-body" },
        createElement(
          "dl",
          {},
          ...row("Current", formatPercent(subject.current)),
          ...row("Shortfall to target", formatPercent(subject.required)),
          ...row("Above target", formatPercent(subject.excess)),
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
      ),
    );
    dom.summary.append(card);
  }
}

function renderTable() {
  dom.tableBody.replaceChildren();

  if (state.subjects.length === 0) {
    const cell = createElement("td", { className: "empty-state", text: "No subjects yet.", attributes: { colspan: "4" } });
    dom.tableBody.append(createElement("tr", {}, cell));
    return;
  }

  for (const subject of state.subjects) {
    const actionButton = (action, label, extraClass = "") =>
      createElement("button", {
        className: `button button-small ${extraClass}`.trim(),
        text: label,
        attributes: {
          type: "button",
          "data-action": action,
          "data-subject": subject.name,
          "aria-label": `${label} ${subject.name}`,
        },
      });

    dom.tableBody.append(
      createElement(
        "tr",
        {},
        createElement("td", { className: "name-cell", text: subject.name }),
        createElement("td", { className: "numeric", text: String(subject.attended) }),
        createElement("td", { className: "numeric", text: String(subject.conducted) }),
        createElement(
          "td",
          { className: "actions" },
          actionButton("edit", "Edit"),
          " ",
          actionButton("delete", "Delete", "button-danger"),
        ),
      ),
    );
  }
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

function openSubjectDialog(subject) {
  state.editingName = subject ? subject.name : null;
  touched.name = touched.attended = touched.conducted = false;
  clearSubjectErrors();

  dom.subjectTitle.textContent = subject ? "Edit subject" : "Add subject";
  dom.name.value = subject ? subject.name : "";
  dom.name.readOnly = Boolean(subject); // locked until the user chooses to rename
  dom.renameButton.hidden = !subject;
  dom.attended.value = subject ? subject.attended : 0;
  dom.conducted.value = subject ? subject.conducted : 0;

  dom.subjectDialog.showModal();
  (subject ? dom.attended : dom.name).focus();
}

function unlockName() {
  dom.name.readOnly = false;
  dom.renameButton.hidden = true;
  dom.name.focus();
  dom.name.select();
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

  dom.subjectDialog.close();
  refresh();
}

function deleteSubject(subject) {
  if (!window.confirm(`Delete "${subject.name}"?`)) return;

  const outcome = toOutcome(state.register.remove(subject.name));
  if (!outcome.ok) {
    showBanner(outcome.message);
    return;
  }
  refresh();
}

/* ---------- Target form ---------- */

function clearTargetError() {
  dom.targetError.hidden = true;
  dom.targetError.textContent = "";
  dom.targetInput.removeAttribute("aria-invalid");
}

function showTargetError(message) {
  dom.targetError.textContent = message;
  dom.targetError.hidden = false;
  dom.targetInput.setAttribute("aria-invalid", "true");
}

/** Returns the entered percentage, or null after showing an error. */
function validateTarget() {
  clearTargetError();
  const value = dom.targetInput.valueAsNumber;

  if (!Number.isFinite(value)) {
    showTargetError("Enter a valid number.");
    return null;
  }

  const outcome = toOutcome(state.core.validateDesiredPercentage(value));
  if (!outcome.ok) {
    showTargetError(outcome.message);
    return null;
  }
  return value;
}

function openTargetDialog() {
  clearTargetError();
  dom.targetInput.value = state.target;
  dom.targetDialog.showModal();
  dom.targetInput.select();
}

function handleTargetSubmit(event) {
  event.preventDefault();

  const value = validateTarget();
  if (value === null) return;

  const outcome = toOutcome(state.register.setDesiredPercentage(value));
  if (!outcome.ok) {
    showTargetError(outcome.message);
    return;
  }

  state.target = value;
  dom.targetDialog.close();
  refresh();
}

/* ---------- Setup ---------- */

function configureInputs() {
  const { MAX_CLASSES, MIN_DESIRED_PERCENTAGE, MAX_DESIRED_PERCENTAGE } = state.core;

  dom.attended.max = MAX_CLASSES;
  dom.conducted.max = MAX_CLASSES;
  dom.targetInput.min = MIN_DESIRED_PERCENTAGE;
  dom.targetInput.max = MAX_DESIRED_PERCENTAGE;
  dom.targetHint.textContent = `Allowed range: ${MIN_DESIRED_PERCENTAGE}% to ${MAX_DESIRED_PERCENTAGE}%.`;
}

function bindEvents() {
  dom.addButton.addEventListener("click", () => openSubjectDialog(null));
  dom.targetButton.addEventListener("click", openTargetDialog);
  dom.renameButton.addEventListener("click", unlockName);

  dom.subjectForm.addEventListener("submit", handleSubjectSubmit);
  dom.targetForm.addEventListener("submit", handleTargetSubmit);

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
  dom.targetInput.addEventListener("input", validateTarget);

  for (const button of document.querySelectorAll("[data-close-dialog]")) {
    button.addEventListener("click", () => button.closest("dialog").close());
  }

  dom.tableBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const subject = state.subjects.find((item) => item.name === button.dataset.subject);
    if (!subject) return;

    if (button.dataset.action === "edit") openSubjectDialog(subject);
    else deleteSubject(subject);
  });
}

async function initialize() {
  try {
    if (typeof ACalcModule !== "function") {
      throw new Error("The WebAssembly module was not found. Check that build-wasm/acalc.js loaded.");
    }

    state.core = await ACalcModule();
    state.register = new state.core.AttendanceRegister();
    state.target = state.core.DESIRED_PERCENTAGE;

    configureInputs();
    bindEvents();
    dom.addButton.disabled = false;
    dom.targetButton.disabled = false;
    refresh();
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