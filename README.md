# CircuitDX — Electronic Circuit Fault Detection and Diagnosis System

## 1. Introduction

**CircuitDX** now uses a modern diagnostic-dashboard interface while keeping the original software-only architecture.

CircuitDX is a browser-based educational tool that helps electronics students practice fault-finding on common circuits. You pick a circuit, type in what your multimeter measured, and a rule-based engine compares your readings against expected values to suggest the most likely fault — along with possible causes and a numbered troubleshooting procedure.

## 2. Problem Statement

Troubleshooting is usually learned by trial and error at the lab bench, often without immediate feedback on whether a reasoning path is sound. Students frequently know *how* to measure a circuit but struggle to connect an abnormal reading back to a specific probable cause. CircuitDX gives that reasoning step a structured, repeatable practice environment that works offline and needs no lab hardware.

## 3. Objectives

- Let a user select a circuit and enter measured electrical values.
- Compare measured values against expected ranges for that circuit.
- Detect abnormal readings and rank the most likely faults by a confidence score.
- Explain possible causes and provide numbered troubleshooting steps.
- Clearly distinguish a "most likely fault" from a "confirmed fault."
- Run entirely offline, in a single browser tab, with no server or install step.

## 4. Features

- 8 supported circuits spanning basic passive circuits through BJT/MOSFET amplifiers.
- Rule-based diagnostic engine with a transparent symptom-matching confidence score.
- Top-3 ranked fault candidates per diagnosis, plus explicit "circuit appears normal" detection.
- Searchable circuit library.
- Diagnosis history stored in `localStorage`, with a working app even if storage is unavailable.
- Light and dark themes.
- Fully responsive layout (desktop and mobile).
- Client-side input validation with friendly error messages.
- "Learn" section with a working-principle summary per circuit.

## 5. Technologies Used

- HTML5
- CSS3 (custom properties, no framework)
- Vanilla JavaScript (ES6+, no build step, no dependencies)

No React, Node.js, Python, backend, database, or API key is used or required.

## 6. System Requirements

- Any modern desktop or mobile browser (Chrome, Firefox, Edge, Safari).
- No installation, server, or internet connection required after download.

## 7. Project Structure

```
circuit-fault-detection/
│
├── index.html      Single-page app shell and all section markup
├── style.css        All styling, including light/dark theme tokens
├── script.js        Circuit data, diagnostic engine, and UI logic
└── README.md         This file
```

## 8. How to Run

1. Download or copy the `circuit-fault-detection` folder.
2. Open `index.html` directly in any modern browser (double-click it, or use "Open File").
3. No server, build step, or account is needed.

## 9. How Diagnosis Works

1. **Select a circuit** from the library (search by name, e.g. "LED", "555", "MOSFET").
2. **Enter measured values** for each relevant test point (only fields relevant to that circuit are shown).
3. The app **validates** each input (empty, non-numeric, negative, or out-of-plausible-range values are rejected with a specific message).
4. Each measurement is compared against that circuit's **expected range**.
5. If every measurement is within range, the result is **"Circuit appears normal."**
6. Otherwise, each possible fault for that circuit has a small set of **symptom conditions** (e.g. "output voltage reads zero" + "input voltage is normal"). The engine counts how many of a fault's symptom conditions match your entered values and expresses that as **matched / total → confidence %**.
7. The **top 3 faults by confidence** are shown, each with possible causes and numbered troubleshooting steps.
8. Every diagnosis is saved to your local **history** (circuit, timestamp, measured values, diagnosis, confidence).

## 10. Supported Circuits

1. LED Circuit
2. Voltage Divider
3. Half-Wave Rectifier
4. Full-Wave Rectifier
5. Common-Emitter BJT Amplifier
6. Common-Source MOSFET Amplifier
7. 555 Timer Astable Circuit
8. RC Low-Pass Filter

## 11. Fault Detection Methodology

Each circuit defines:

- A set of **fields** (what you measure), each with an expected min/max range.
- A set of **faults**, each defined by a small list of **symptoms** — conditions like "this field reads zero," "this field is above its expected range," or "this field is within its expected range."

For a given fault, `confidence = (matched symptoms / total symptoms) × 100`. Faults with at least one matching symptom are ranked by confidence, and the top three are shown. This is a **rule-based estimation**, not a measured statistical probability — it reflects how well your readings match a known fault pattern, nothing more. The interface deliberately says **"most likely fault"**, never **"confirmed faulty component."**

## 12. Advantages

- Easy to use, no hardware required
- Fast, fully offline diagnosis
- Explains its reasoning instead of only giving a verdict
- Helps build troubleshooting intuition before touching a real board
- Works on both desktop and mobile

## 13. Limitations

- CircuitDX provides a rule-based estimation and **cannot physically test a component**.
- It can only diagnose faults it has a rule for — real-world faults may not match any listed pattern.
- Confidence percentages are symptom-matching scores, not measured statistical probabilities.
- It is not a substitute for a multimeter, oscilloscope, or a qualified technician.

## 14. Future Enhancements

- AI-assisted diagnosis using measurement history and free-text symptom descriptions
- Real-time sensor integration (Arduino / ESP32) for automatic measurement acquisition
- Oscilloscope waveform capture and analysis
- PCB image analysis for visual fault spotting
- Native mobile application
- Cloud-synced diagnosis history across devices

## 15. UI / UX Upgrade

The modern interface adds a glass-style engineering dashboard, responsive circuit cards, live engine status, workflow guidance, improved measurement forms, richer result summaries, responsive mobile navigation, and a more polished visual hierarchy. The diagnostic logic remains transparent and rule-based.

## 16. Conclusion

CircuitDX turns the "compare measured to expected, then reason about the mismatch" process that experienced technicians do intuitively into a structured, explainable tool for students. It is intentionally simple — plain HTML, CSS, and JavaScript — so it stays easy to read, easy to extend with new circuits or fault rules, and easy to run anywhere without setup.
