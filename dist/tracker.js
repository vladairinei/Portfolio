"use strict";
// ----------- Helpers -----------
function parseTime(str) {
    const [h, m] = str.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m))
        throw new Error("Invalid time format");
    return h * 60 + m;
}
function formatTime(minutes) {
    const h = Math.floor(minutes / 60).toString().padStart(2, "0");
    const m = (minutes % 60).toString().padStart(2, "0");
    return `${h}:${m}`;
}
// Night bonus minutes: 20:00–06:00, subtracting pause (placed mid-shift)
function calcNightMinutes(start, end, pauseMin) {
    if (end < start)
        end += 1440; // overnight shift
    const totalWorked = end - start;
    if (totalWorked <= 0)
        return 0;
    // Place pause in the middle of the shift
    const pauseStart = start + Math.floor(totalWorked / 2) - Math.floor(pauseMin / 2);
    const pauseEnd = pauseStart + pauseMin;
    let nightMinutes = 0;
    for (let t = start; t < end; t++) {
        if (t >= pauseStart && t < pauseEnd)
            continue; // skip pause minutes
        const minuteOfDay = t % 1440;
        if (minuteOfDay < 360 || minuteOfDay >= 1200) {
            nightMinutes++;
        }
    }
    return nightMinutes;
}
function loadEntries() {
    const data = localStorage.getItem("entries");
    return data ? JSON.parse(data) : [];
}
function saveEntry(entry) {
    const entries = loadEntries();
    const idx = entries.findIndex(e => e.date === entry.date);
    if (idx !== -1)
        entries[idx] = entry;
    else
        entries.push(entry);
    localStorage.setItem("entries", JSON.stringify(entries));
}
// Vacation allowance per year (default 30)
function loadAllowance() {
    const raw = localStorage.getItem("vacAllowance");
    const n = raw ? parseInt(raw) : 30;
    return Number.isFinite(n) ? n : 30;
}
function saveAllowance(n) {
    localStorage.setItem("vacAllowance", String(n));
}
// ----------- DOM Setup -----------
const form = document.getElementById("workForm");
const dayType = document.getElementById("dayType");
const timeInputs = document.getElementById("timeInputs");
const workedTime = document.getElementById("workedTime");
const nightTime = document.getElementById("nightTime");
const infoMessage = document.getElementById("infoMessage");
// History table (may not exist if you switched to calendar view)
const historyTable = document.querySelector("#historyTable tbody");
// Summary DOM (separate month + year)
const monthOnly = document.getElementById("monthOnly");
const yearPicker = document.getElementById("yearPicker");
const vacAllowanceInput = document.getElementById("vacAllowance");
const saveAllowanceBtn = document.getElementById("saveAllowanceBtn");
const sumWorked = document.getElementById("sumWorked");
const sumNight = document.getElementById("sumNight");
const sumDaysNormal = document.getElementById("sumDaysNormal");
const sumDaysVacation = document.getElementById("sumDaysVacation");
const sumDaysSick = document.getElementById("sumDaysSick");
const sumVacUsed = document.getElementById("sumVacUsed");
const sumVacRemaining = document.getElementById("sumVacRemaining");
// Defaults for month/year selectors
if (!yearPicker.value)
    yearPicker.value = String(new Date().getFullYear());
if (!monthOnly.value)
    monthOnly.value = (new Date().getMonth() + 1).toString().padStart(2, "0");
// --- Force current month/year at startup (tiny, safe) ---
(function initMonthYearToToday() {
    const now = new Date();
    const y = String(now.getFullYear());
    const m = String(now.getMonth() + 1).padStart(2, "0");
    if (!yearPicker.value)
        yearPicker.value = y;
    if (!monthOnly.value)
        monthOnly.value = m;
    // If you use the fancy year button label:
    const yearLabel = document.getElementById("yearLabel");
    if (yearLabel)
        yearLabel.textContent = yearPicker.value;
})();
function getSelectedMonthKey() {
    return `${yearPicker.value}-${monthOnly.value}`; // YYYY-MM
}
// Date quick controls
const workDateInput = document.getElementById("workDate");
const openCalendarBtn = document.getElementById("openCalendarBtn");
const todayBtn = document.getElementById("todayBtn");
const yesterdayBtn = document.getElementById("yesterdayBtn");
const minusDayBtn = document.getElementById("minusDayBtn");
const plusDayBtn = document.getElementById("plusDayBtn");
// Month nav
const prevMonthBtn = document.getElementById("prevMonthBtn");
const nextMonthBtn = document.getElementById("nextMonthBtn");
// Calendar & drawer
const calendarGrid = document.getElementById("calendarGrid");
const dayDrawer = document.getElementById("dayDrawer");
const drawerClose = document.getElementById("drawerClose");
const drawerDate = document.getElementById("drawerDate");
const drawerBody = document.getElementById("drawerBody");
const drawerEdit = document.getElementById("drawerEdit");
const drawerDelete = document.getElementById("drawerDelete");
// Year dropdown grid (optional; works if present in HTML)
const yearDropdownBtn = document.getElementById("yearDropdownBtn");
const yearDropdown = document.getElementById("yearDropdown");
const yearLabel = document.getElementById("yearLabel");
const yearRangeLabel = document.getElementById("yearRangeLabel");
const yearGrid = document.getElementById("yearGrid");
const prevDecadeBtn = document.getElementById("prevDecadeBtn");
const nextDecadeBtn = document.getElementById("nextDecadeBtn");
if (yearLabel)
    yearLabel.textContent = yearPicker.value;
// ----------- History Rendering (guarded) -----------
function renderHistory() {
    var _a, _b;
    if (!historyTable)
        return; // no table in calendar mode
    const entries = loadEntries().sort((a, b) => b.date.localeCompare(a.date));
    historyTable.innerHTML = "";
    for (const entry of entries) {
        const row = document.createElement("tr");
        const typeLabel = entry.type === "normal" ? "Normal" :
            entry.type === "vacation" ? "Vacation" : "Sick Leave";
        row.innerHTML = `
      <td>${entry.date}</td>
      <td>${typeLabel}</td>
      <td>${formatTime(entry.workedMinutes)}</td>
      <td>${formatTime(entry.nightMinutes)}</td>
      <td>
        <button class="edit-btn" data-date="${entry.date}">✏️</button>
        <button class="delete-btn" data-date="${entry.date}">🗑️</button>
      </td>
    `;
        historyTable.appendChild(row);
        // Delete
        (_a = row.querySelector(".delete-btn")) === null || _a === void 0 ? void 0 : _a.addEventListener("click", () => {
            const updated = loadEntries().filter(e => e.date !== entry.date);
            localStorage.setItem("entries", JSON.stringify(updated));
            renderHistory();
            renderSummary();
        });
        // Edit (prefill form)
        (_b = row.querySelector(".edit-btn")) === null || _b === void 0 ? void 0 : _b.addEventListener("click", () => {
            const formDate = document.getElementById("workDate");
            const formType = document.getElementById("dayType");
            const formStart = document.getElementById("startTime");
            const formEnd = document.getElementById("endTime");
            const formPause = document.getElementById("pauseTime");
            formDate.value = entry.date;
            formType.value = entry.type;
            if (entry.type === "normal") {
                formStart.value = "";
                formEnd.value = "";
                formPause.value = "0";
                timeInputs.style.display = "block";
            }
            else {
                timeInputs.style.display = "none";
            }
            infoMessage.textContent = "Editing entry...";
            formDate.scrollIntoView({ behavior: "smooth", block: "center" });
        });
    }
}
// ----------- Summary Rendering -----------
function renderSummary() {
    const entries = loadEntries();
    // Ensure selectors are set
    if (!yearPicker.value)
        yearPicker.value = String(new Date().getFullYear());
    if (!monthOnly.value)
        monthOnly.value = (new Date().getMonth() + 1).toString().padStart(2, "0");
    const monthKey = getSelectedMonthKey(); // YYYY-MM
    const yearKey = yearPicker.value; // YYYY
    const monthEntries = entries.filter(e => e.date.slice(0, 7) === monthKey);
    const yearEntries = entries.filter(e => e.date.slice(0, 4) === yearKey);
    const totalWorkedMonth = monthEntries.reduce((s, e) => s + e.workedMinutes, 0);
    const totalNightMonth = monthEntries.reduce((s, e) => s + e.nightMinutes, 0);
    const daysNormal = monthEntries.filter(e => e.type === "normal").length;
    const daysVacation = monthEntries.filter(e => e.type === "vacation").length;
    const daysSick = monthEntries.filter(e => e.type === "sick").length;
    sumWorked.textContent = formatTime(totalWorkedMonth);
    sumNight.textContent = formatTime(totalNightMonth);
    sumDaysNormal.textContent = String(daysNormal);
    sumDaysVacation.textContent = String(daysVacation);
    sumDaysSick.textContent = String(daysSick);
    const allowance = loadAllowance();
    vacAllowanceInput.value = String(allowance);
    const vacUsedThisYear = yearEntries.filter(e => e.type === "vacation").length;
    const remaining = Math.max(0, allowance - vacUsedThisYear);
    sumVacUsed.textContent = String(vacUsedThisYear);
    sumVacRemaining.textContent = String(remaining);
    // Also refresh the calendar if present
    renderCalendar();
}
// ----------- Date utilities & quick controls -----------
function fmtDate(d) {
    const y = d.getFullYear();
    const m = (d.getMonth() + 1).toString().padStart(2, "0");
    const day = d.getDate().toString().padStart(2, "0");
    return `${y}-${m}-${day}`;
}
function parseISO(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, (m - 1), d);
}
function shiftDate(dateStr, deltaDays) {
    const dt = dateStr ? parseISO(dateStr) : new Date();
    dt.setDate(dt.getDate() + deltaDays);
    return fmtDate(dt);
}
// Default date to today if empty
if (!workDateInput.value)
    workDateInput.value = fmtDate(new Date());
// Open native date picker (Chromium), or focus fallback
openCalendarBtn === null || openCalendarBtn === void 0 ? void 0 : openCalendarBtn.addEventListener("click", () => {
    var _a, _b, _c;
    (_c = (_b = (_a = workDateInput).showPicker) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : workDateInput.focus();
});
todayBtn === null || todayBtn === void 0 ? void 0 : todayBtn.addEventListener("click", () => {
    workDateInput.value = fmtDate(new Date());
});
yesterdayBtn === null || yesterdayBtn === void 0 ? void 0 : yesterdayBtn.addEventListener("click", () => {
    workDateInput.value = shiftDate(workDateInput.value, -1);
});
minusDayBtn === null || minusDayBtn === void 0 ? void 0 : minusDayBtn.addEventListener("click", () => {
    workDateInput.value = shiftDate(workDateInput.value, -1);
});
plusDayBtn === null || plusDayBtn === void 0 ? void 0 : plusDayBtn.addEventListener("click", () => {
    workDateInput.value = shiftDate(workDateInput.value, +1);
});
// Month nav helpers
function shiftMonth(year, month, delta) {
    let y = year;
    let m = month + delta;
    if (m <= 0) {
        m = 12;
        y--;
    }
    if (m > 12) {
        m = 1;
        y++;
    }
    return { y, m };
}
prevMonthBtn === null || prevMonthBtn === void 0 ? void 0 : prevMonthBtn.addEventListener("click", () => {
    const y = parseInt(yearPicker.value) || new Date().getFullYear();
    const m = parseInt(monthOnly.value) || (new Date().getMonth() + 1);
    const next = shiftMonth(y, m, -1);
    yearPicker.value = String(next.y);
    monthOnly.value = next.m.toString().padStart(2, "0");
    renderSummary();
});
nextMonthBtn === null || nextMonthBtn === void 0 ? void 0 : nextMonthBtn.addEventListener("click", () => {
    const y = parseInt(yearPicker.value) || new Date().getFullYear();
    const m = parseInt(monthOnly.value) || (new Date().getMonth() + 1);
    const next = shiftMonth(y, m, +1);
    yearPicker.value = String(next.y);
    monthOnly.value = next.m.toString().padStart(2, "0");
    renderSummary();
});
// Update summary when month/year changes
monthOnly === null || monthOnly === void 0 ? void 0 : monthOnly.addEventListener("change", renderSummary);
yearPicker === null || yearPicker === void 0 ? void 0 : yearPicker.addEventListener("change", () => {
    renderSummary();
    if (yearLabel)
        yearLabel.textContent = yearPicker.value;
});
// ----------- Calendar rendering & drawer -----------
function daysInMonth(year, month1to12) {
    return new Date(year, month1to12, 0).getDate(); // month is 1–12 here
}
function firstWeekdayIndexMonFirst(year, month1to12) {
    // JS: 0=Sun..6=Sat; convert to Mon=0..Sun=6
    const d = new Date(year, month1to12 - 1, 1).getDay();
    return (d + 6) % 7;
}
function entryMapByDate() {
    const map = {};
    for (const e of loadEntries())
        map[e.date] = e;
    return map;
}
function renderCalendar() {
    if (!calendarGrid)
        return;
    const y = parseInt(yearPicker.value) || new Date().getFullYear();
    const mStr = monthOnly.value || (new Date().getMonth() + 1).toString().padStart(2, "0");
    const m = parseInt(mStr); // 1..12
    const map = entryMapByDate();
    const todayISO = fmtDate(new Date());
    const days = daysInMonth(y, m);
    const leading = firstWeekdayIndexMonFirst(y, m);
    const trailing = (7 - ((leading + days) % 7)) % 7;
    const prevMonth = m === 1 ? 12 : m - 1;
    const prevYear = m === 1 ? y - 1 : y;
    const prevDays = daysInMonth(prevYear, prevMonth);
    const nextMonth = m === 12 ? 1 : m + 1;
    const nextYear = m === 12 ? y + 1 : y;
    calendarGrid.innerHTML = "";
    // Helper to build a day cell
    const makeCell = (dateISO, inMonth) => {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "cal-day";
        if (!inMonth)
            cell.classList.add("outside");
        // weekend highlight (Sat/Sun)
        const dow = new Date(dateISO).getDay(); // 0=Sun..6=Sat
        if (dow === 0 || dow === 6)
            cell.classList.add("weekend");
        if (dateISO === todayISO)
            cell.classList.add("today");
        // header line
        const num = document.createElement("div");
        num.className = "day-num";
        num.textContent = String(parseInt(dateISO.split("-")[2]));
        cell.appendChild(num);
        // badges
        const badges = document.createElement("div");
        badges.className = "badges";
        const e = map[dateISO];
        if (e) {
            const type = document.createElement("span");
            type.className = `badge type-${e.type}`;
            type.textContent =
                e.type === "normal" ? "Normal" :
                    e.type === "vacation" ? "Vacation" : "Sick";
            badges.appendChild(type);
            if (e.type === "normal") {
                const w = document.createElement("span");
                w.className = "badge time";
                w.textContent = formatTime(e.workedMinutes);
                badges.appendChild(w);
                if (e.nightMinutes > 0) {
                    const n = document.createElement("span");
                    n.className = "badge time";
                    n.textContent = `🌙 ${formatTime(e.nightMinutes)}`;
                    badges.appendChild(n);
                }
            }
        }
        else {
            const add = document.createElement("span");
            add.className = "badge";
            add.textContent = "+ Add";
            badges.appendChild(add);
        }
        cell.appendChild(badges);
        // click → open drawer
        cell.addEventListener("click", () => openDayDrawer(dateISO, e !== null && e !== void 0 ? e : null));
        return cell;
    };
    // Leading days
    for (let i = leading - 1; i >= 0; i--) {
        const day = prevDays - i;
        const dateISO = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        calendarGrid.appendChild(makeCell(dateISO, false));
    }
    // Current month
    for (let d = 1; d <= days; d++) {
        const dateISO = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        calendarGrid.appendChild(makeCell(dateISO, true));
    }
    // Trailing days
    for (let d = 1; d <= trailing; d++) {
        const dateISO = `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        calendarGrid.appendChild(makeCell(dateISO, false));
    }
}
// Drawer logic
let drawerSelectedDate = null;
function openDayDrawer(dateISO, entry) {
    if (!dayDrawer || !drawerDate || !drawerBody || !drawerEdit || !drawerDelete)
        return;
    drawerSelectedDate = dateISO;
    drawerDate.textContent = dateISO;
    if (entry) {
        const typeLabel = entry.type === "normal" ? "Normal" : entry.type === "vacation" ? "Vacation" : "Sick Leave";
        const rows = [
            `<p><strong>Type:</strong> ${typeLabel}</p>`,
            `<p><strong>Worked:</strong> ${formatTime(entry.workedMinutes)}</p>`,
            `<p><strong>Night bonus:</strong> ${formatTime(entry.nightMinutes)}</p>`
        ].join("");
        drawerBody.innerHTML = rows;
        drawerDelete.style.display = ""; // show delete
        drawerEdit.textContent = "Edit";
    }
    else {
        drawerBody.innerHTML = `<p>No entry. Click <strong>Add</strong> to create one.</p>`;
        drawerDelete.style.display = "none"; // hide delete
        drawerEdit.textContent = "Add";
    }
    dayDrawer.setAttribute("aria-hidden", "false");
}
function closeDayDrawer() {
    if (!dayDrawer)
        return;
    dayDrawer.setAttribute("aria-hidden", "true");
    drawerSelectedDate = null;
}
// Drawer events
drawerClose === null || drawerClose === void 0 ? void 0 : drawerClose.addEventListener("click", closeDayDrawer);
dayDrawer === null || dayDrawer === void 0 ? void 0 : dayDrawer.addEventListener("click", (e) => {
    if (e.target === dayDrawer)
        closeDayDrawer(); // click backdrop
});
// Drawer actions
drawerEdit === null || drawerEdit === void 0 ? void 0 : drawerEdit.addEventListener("click", () => {
    var _a, _b, _c;
    if (!drawerSelectedDate)
        return;
    // Prefill the form for this date
    document.getElementById("workDate").value = drawerSelectedDate;
    // If there is an entry, set its type; else default normal
    const entry = loadEntries().find(e => e.date === drawerSelectedDate);
    document.getElementById("dayType").value = (_a = entry === null || entry === void 0 ? void 0 : entry.type) !== null && _a !== void 0 ? _a : "normal";
    // Show inputs for normal; hide for vacation/sick
    timeInputs.style.display = ((_b = entry === null || entry === void 0 ? void 0 : entry.type) !== null && _b !== void 0 ? _b : "normal") === "normal" ? "block" : "none";
    closeDayDrawer();
    // Scroll to form
    (_c = document.getElementById("workForm")) === null || _c === void 0 ? void 0 : _c.scrollIntoView({ behavior: "smooth", block: "start" });
});
drawerDelete === null || drawerDelete === void 0 ? void 0 : drawerDelete.addEventListener("click", () => {
    if (!drawerSelectedDate)
        return;
    const updated = loadEntries().filter(e => e.date !== drawerSelectedDate);
    localStorage.setItem("entries", JSON.stringify(updated));
    closeDayDrawer();
    renderCalendar();
    renderSummary();
});
// ----------- Year dropdown grid (optional) -----------
let baseYear = Math.floor((parseInt(yearPicker.value) || new Date().getFullYear()) / 10) * 10; // start of decade
function renderYearGrid() {
    if (!yearGrid || !yearRangeLabel)
        return;
    const selectedYear = parseInt(yearPicker.value) || new Date().getFullYear();
    yearGrid.innerHTML = "";
    yearRangeLabel.textContent = `${baseYear}–${baseYear + 15}`;
    for (let y = baseYear; y < baseYear + 16; y++) {
        const btn = document.createElement("button");
        btn.className = "year-cell";
        btn.type = "button";
        btn.textContent = String(y);
        if (y === selectedYear)
            btn.classList.add("active");
        btn.addEventListener("click", () => {
            yearPicker.value = String(y);
            if (yearLabel)
                yearLabel.textContent = String(y);
            renderSummary();
            closeYearDropdown();
        });
        yearGrid.appendChild(btn);
    }
}
function openYearDropdown() {
    if (!yearDropdownBtn || !yearDropdown)
        return;
    yearDropdown.hidden = false;
    yearDropdownBtn.setAttribute("aria-expanded", "true");
    renderYearGrid();
}
function closeYearDropdown() {
    if (!yearDropdownBtn || !yearDropdown)
        return;
    yearDropdown.hidden = true;
    yearDropdownBtn.setAttribute("aria-expanded", "false");
}
yearDropdownBtn === null || yearDropdownBtn === void 0 ? void 0 : yearDropdownBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (yearDropdown === null || yearDropdown === void 0 ? void 0 : yearDropdown.hidden)
        openYearDropdown();
    else
        closeYearDropdown();
});
prevDecadeBtn === null || prevDecadeBtn === void 0 ? void 0 : prevDecadeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    baseYear -= 16;
    renderYearGrid();
});
nextDecadeBtn === null || nextDecadeBtn === void 0 ? void 0 : nextDecadeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    baseYear += 16;
    renderYearGrid();
});
document.addEventListener("click", (e) => {
    if (!yearDropdown || !yearDropdownBtn)
        return;
    if (!yearDropdown.hidden) {
        const target = e.target;
        if (!yearDropdown.contains(target) && target !== yearDropdownBtn) {
            closeYearDropdown();
        }
    }
});
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape")
        closeYearDropdown();
});
// ----------- UI Events -----------
dayType.addEventListener("change", () => {
    timeInputs.style.display = dayType.value === "normal" ? "block" : "none";
});
form.addEventListener("submit", (e) => {
    e.preventDefault();
    const type = document.getElementById("dayType").value;
    const date = document.getElementById("workDate").value;
    if (!date) {
        alert("Please choose a date.");
        return;
    }
    if (type !== "normal") {
        const entry = {
            date,
            type,
            workedMinutes: 480, // 8 hours
            nightMinutes: 0
        };
        saveEntry(entry);
        renderHistory();
        renderSummary();
        workedTime.textContent = "08:00";
        nightTime.textContent = "00:00";
        infoMessage.textContent = type === "vacation" ? "Vacation day recorded." : "Sick leave recorded.";
        return;
    }
    const startStr = document.getElementById("startTime").value;
    const endStr = document.getElementById("endTime").value;
    const pauseMin = parseInt(document.getElementById("pauseTime").value) || 0;
    if (!startStr || !endStr) {
        alert("Please fill in both start and end time.");
        return;
    }
    const startMin = parseTime(startStr);
    const endMin = parseTime(endStr);
    let totalWorkMin = endMin - startMin - pauseMin;
    if (totalWorkMin < 0)
        totalWorkMin += 1440;
    const nightMin = calcNightMinutes(startMin, endMin, pauseMin);
    const entry = {
        date,
        type,
        workedMinutes: totalWorkMin,
        nightMinutes: nightMin
    };
    saveEntry(entry);
    renderHistory();
    renderSummary();
    workedTime.textContent = formatTime(totalWorkMin);
    nightTime.textContent = formatTime(nightMin);
    infoMessage.textContent = "Normal work day calculated.";
});
saveAllowanceBtn === null || saveAllowanceBtn === void 0 ? void 0 : saveAllowanceBtn.addEventListener("click", () => {
    const n = parseInt(vacAllowanceInput.value);
    if (!Number.isFinite(n) || n < 0) {
        alert("Please enter a valid non-negative number.");
        return;
    }
    saveAllowance(n);
    renderSummary();
});
// ----------- Initial Setup -----------
renderHistory();
renderSummary();
//# sourceMappingURL=tracker.js.map