/* =========================================================
   CircuitDX — Electronic Circuit Fault Detection & Diagnosis
   Pure vanilla JS. No dependencies, no backend.

   Sections:
   1. Safe localStorage wrapper
   2. Circuit data (fields, expected ranges, fault rules)
   3. Schematic renderer (generic SVG built from component list)
   4. Diagnostic engine (validate -> score -> rank)
   5. UI wiring / navigation / rendering
   ========================================================= */

/* ---------------------------------------------------------
   1. SAFE STORAGE — app keeps working even if localStorage
      is disabled (private browsing, restricted iframe, etc.)
   --------------------------------------------------------- */
const safeStorage = (() => {
  let memoryFallback = {};
  let available = true;
  try {
    const testKey = "__circuitdx_test__";
    window.localStorage.setItem(testKey, "1");
    window.localStorage.removeItem(testKey);
  } catch (e) {
    available = false;
  }
  return {
    get(key) {
      if (available) {
        try { return window.localStorage.getItem(key); } catch (e) { /* fall through */ }
      }
      return Object.prototype.hasOwnProperty.call(memoryFallback, key) ? memoryFallback[key] : null;
    },
    set(key, value) {
      if (available) {
        try { window.localStorage.setItem(key, value); return; } catch (e) { /* fall through */ }
      }
      memoryFallback[key] = value;
    },
    remove(key) {
      if (available) {
        try { window.localStorage.removeItem(key); return; } catch (e) { /* fall through */ }
      }
      delete memoryFallback[key];
    }
  };
})();

/* ---------------------------------------------------------
   2. CIRCUIT DATA
   Each field: { key, label, unit, expectedMin, expectedMax,
                 expectedText, validMin, validMax }
   Each fault symptom: { key, type, target?, tol? }
     type: 'zero' | 'low' | 'high' | 'inRange' | 'outOfRange' | 'near'
   --------------------------------------------------------- */
const CIRCUITS = {

  led: {
    name: "LED Circuit",
    description: "A single LED with a current-limiting series resistor driven from a DC supply.",
    difficulty: "Beginner",
    components: ["DC Supply", "Series Resistor", "LED"],
    supplyText: "5 V DC",
    fields: [
      { key: "supplyVoltage", label: "Supply Voltage", unit: "V", expectedMin: 4.8, expectedMax: 5.2, expectedText: "4.8 – 5.2 V", validMin: 0, validMax: 30 },
      { key: "ledVoltage", label: "LED Voltage", unit: "V", expectedMin: 1.8, expectedMax: 2.2, expectedText: "1.8 – 2.2 V", validMin: 0, validMax: 30 },
      { key: "current", label: "Circuit Current", unit: "mA", expectedMin: 8, expectedMax: 15, expectedText: "8 – 15 mA", validMin: 0, validMax: 1000 },
      { key: "resistor", label: "Series Resistor", unit: "Ω", expectedMin: 200, expectedMax: 240, expectedText: "200 – 240 Ω", validMin: 0, validMax: 1000000 }
    ],
    faults: [
      {
        id: "open-led", name: "Open LED / Open Connection",
        causes: ["The LED's internal element may be damaged (open).", "A soldered or breadboard connection to the LED may be broken."],
        troubleshooting: ["Check the power supply reading at the source.", "Check wiring continuity from supply to LED to resistor to ground.", "Reseat or re-solder the LED leads.", "Swap in a known-good LED to confirm."],
        symptoms: [{ key: "current", type: "zero" }, { key: "ledVoltage", type: "high" }]
      },
      {
        id: "reversed-led", name: "Reversed LED",
        causes: ["The LED may be installed backwards (anode/cathode swapped).", "A reversed LED blocks current in this bias direction."],
        troubleshooting: ["Check the LED's flat edge / shorter lead for correct cathode orientation.", "Verify the LED symbol on your circuit diagram against the physical orientation.", "Reverse the LED and re-test."],
        symptoms: [{ key: "current", type: "zero" }, { key: "supplyVoltage", type: "inRange" }]
      },
      {
        id: "broken-connection", name: "Broken Connection Before the LED",
        causes: ["A wire or breadboard track feeding the LED branch is broken.", "The resistor may not be making contact."],
        troubleshooting: ["Check wiring continuity from the supply to the resistor.", "Check the resistor is fully seated in the breadboard.", "Measure voltage at each node moving from supply toward ground."],
        symptoms: [{ key: "current", type: "zero" }, { key: "ledVoltage", type: "zero" }]
      },
      {
        id: "wrong-resistor-high", name: "Incorrect (Oversized) Series Resistor",
        causes: ["A higher-value resistor than specified was used, starving the LED of current.", "Resistor color bands may have been misread."],
        troubleshooting: ["Measure the resistor out of circuit with a multimeter.", "Compare against the color-code / marked value.", "Replace with the correct 220 Ω resistor."],
        symptoms: [{ key: "current", type: "low" }, { key: "resistor", type: "high" }]
      },
      {
        id: "no-supply", name: "No / Insufficient Supply Voltage",
        causes: ["The power source is off, disconnected, or a battery is depleted.", "A supply wire may be loose."],
        troubleshooting: ["Verify the supply is switched on.", "Measure directly at the supply terminals.", "Check the battery or bench supply output."],
        symptoms: [{ key: "supplyVoltage", type: "zero" }, { key: "current", type: "zero" }, { key: "ledVoltage", type: "zero" }]
      },
      {
        id: "excessive-supply", name: "Excessive Supply Voltage",
        causes: ["The supply is set higher than the design voltage.", "An undersized resistor combined with high supply can overheat the LED."],
        troubleshooting: ["Check the bench supply setting against the design value.", "Recalculate the required series resistor for the actual supply voltage.", "Reduce supply voltage or increase resistor value before continuing."],
        symptoms: [{ key: "supplyVoltage", type: "high" }, { key: "current", type: "high" }]
      }
    ],
    learn: {
      principle: "Current flows from the supply through the series resistor and the LED to ground. The resistor limits current to a safe level; the LED drops roughly its forward voltage (about 2 V for a standard red LED) and lights up.",
      expectedBehavior: "With a 5 V supply and 220 Ω resistor, expect roughly 2 V across the LED, about 3 V across the resistor, and 8–15 mA of current — the LED should glow at steady brightness.",
      commonFaults: ["Open or reversed LED", "Broken connection", "Wrong resistor value", "No supply voltage", "Excessive supply voltage"],
      method: "Start at the supply and measure toward ground. The node where the expected voltage disappears tells you which component is between good and bad readings."
    }
  },

  divider: {
    name: "Voltage Divider",
    description: "Two series resistors (R1, R2) that scale a DC input down to a proportional output voltage.",
    difficulty: "Beginner",
    components: ["DC Supply", "R1", "R2"],
    supplyText: "12 V DC",
    fields: [
      { key: "inputVoltage", label: "Input Voltage", unit: "V", expectedMin: 11.5, expectedMax: 12.5, expectedText: "11.5 – 12.5 V", validMin: 0, validMax: 60 },
      { key: "outputVoltage", label: "Output Voltage", unit: "V", expectedMin: 5.7, expectedMax: 6.3, expectedText: "5.7 – 6.3 V", validMin: 0, validMax: 60 },
      { key: "r1", label: "R1 (measured)", unit: "Ω", expectedMin: 9000, expectedMax: 11000, expectedText: "9 – 11 kΩ", validMin: 0, validMax: 10000000 },
      { key: "r2", label: "R2 (measured)", unit: "Ω", expectedMin: 9000, expectedMax: 11000, expectedText: "9 – 11 kΩ", validMin: 0, validMax: 10000000 }
    ],
    faults: [
      {
        id: "open-r2", name: "Open R2 (or open load path)",
        causes: ["R2 has an open internal break.", "The connection from the output node to R2 is broken."],
        troubleshooting: ["Measure R2 out of circuit for continuity.", "Check the solder/breadboard joint at the output node.", "Reseat R2 and re-test."],
        symptoms: [{ key: "outputVoltage", type: "high" }]
      },
      {
        id: "open-r1", name: "Open R1",
        causes: ["R1 has an open internal break, so no current reaches the divider.", "The connection from the input to R1 is broken."],
        troubleshooting: ["Measure R1 out of circuit for continuity.", "Check the joint between the supply and R1.", "Confirm input voltage is present at the R1 terminal."],
        symptoms: [{ key: "outputVoltage", type: "zero" }]
      },
      {
        id: "shorted-r2", name: "Shorted R2",
        causes: ["R2 has failed short, pulling the output to ground.", "A solder bridge shorts the output node to ground."],
        troubleshooting: ["Inspect the board for solder bridges near R2.", "Measure R2 out of circuit — a short reads near 0 Ω.", "Replace R2."],
        symptoms: [{ key: "outputVoltage", type: "zero" }, { key: "inputVoltage", type: "inRange" }]
      },
      {
        id: "wrong-r1", name: "Incorrect R1 Value",
        causes: ["R1 is a different value than specified, skewing the divider ratio."],
        troubleshooting: ["Measure R1 out of circuit and compare to the design value.", "Replace with the correct resistor.", "Recompute expected output for the actual resistor values if substitution is intentional."],
        symptoms: [{ key: "outputVoltage", type: "low" }, { key: "r1", type: "high" }]
      },
      {
        id: "wrong-r2", name: "Incorrect R2 Value",
        causes: ["R2 is a different value than specified, skewing the divider ratio."],
        troubleshooting: ["Measure R2 out of circuit and compare to the design value.", "Replace with the correct resistor."],
        symptoms: [{ key: "outputVoltage", type: "low" }, { key: "r2", type: "low" }]
      },
      {
        id: "no-input", name: "No Input Voltage",
        causes: ["The supply is off or disconnected."],
        troubleshooting: ["Verify the supply is switched on and set correctly.", "Measure directly at the supply terminals."],
        symptoms: [{ key: "inputVoltage", type: "zero" }, { key: "outputVoltage", type: "zero" }]
      }
    ],
    learn: {
      principle: "Two resistors in series across the supply form a divider. The output, taken between R1 and R2, equals Vin × R2 / (R1 + R2).",
      expectedBehavior: "With equal 10 kΩ resistors and a 12 V input, the output should sit at about 6 V — half the input.",
      commonFaults: ["Open R1 or R2", "Shorted R2", "Wrong resistor values", "No input voltage"],
      method: "An open R2 makes the (high-impedance) meter read close to full input voltage at the output, since no current flows to pull it down. An open R1 or shorted R2 pulls the output toward zero instead."
    }
  },

  halfwave: {
    name: "Half-Wave Rectifier",
    description: "A single diode that conducts on only one half of the AC cycle, producing a pulsed DC output.",
    difficulty: "Intermediate",
    components: ["AC Source", "Diode", "Load Resistor"],
    supplyText: "12 V AC (rms)",
    fields: [
      { key: "acInput", label: "AC Input (rms)", unit: "V", expectedMin: 11, expectedMax: 13, expectedText: "11 – 13 V", validMin: 0, validMax: 240 },
      { key: "dcOutput", label: "DC Output (avg)", unit: "V", expectedMin: 4.5, expectedMax: 5.5, expectedText: "4.5 – 5.5 V", validMin: 0, validMax: 240 },
      { key: "diodeVoltage", label: "Diode Forward Drop", unit: "V", expectedMin: 0.5, expectedMax: 0.8, expectedText: "0.5 – 0.8 V", validMin: 0, validMax: 30 }
    ],
    faults: [
      {
        id: "diode-open", name: "Diode Open",
        causes: ["The diode's junction has failed open and no longer conducts."],
        troubleshooting: ["Check AC input is present first.", "Measure the diode out of circuit in both directions with a multimeter diode-test range.", "Replace the diode if it shows no conduction in either direction."],
        symptoms: [{ key: "dcOutput", type: "zero" }, { key: "acInput", type: "inRange" }]
      },
      {
        id: "diode-short", name: "Diode Shorted",
        causes: ["The diode has failed short, passing both halves of the AC cycle unrectified."],
        troubleshooting: ["Measure the diode out of circuit — a short reads near 0 Ω both directions.", "Check for a fuse or supply protection that may have tripped.", "Replace the diode."],
        symptoms: [{ key: "dcOutput", type: "high" }, { key: "diodeVoltage", type: "zero" }]
      },
      {
        id: "reverse-diode", name: "Reverse Diode Connection",
        causes: ["The diode is installed with its polarity reversed, blocking the intended conduction half-cycle."],
        troubleshooting: ["Check the cathode band orientation against the circuit diagram.", "Reverse the diode and re-test."],
        symptoms: [{ key: "dcOutput", type: "zero" }, { key: "acInput", type: "inRange" }, { key: "diodeVoltage", type: "high" }]
      },
      {
        id: "loose-connection", name: "Loose Connection",
        causes: ["A wire from the AC source or to the load is not making contact."],
        troubleshooting: ["Check every connection along the signal path with the circuit powered off.", "Reseat all leads and re-test."],
        symptoms: [{ key: "acInput", type: "zero" }, { key: "dcOutput", type: "zero" }]
      },
      {
        id: "low-output", name: "Weak Output / Load Issue",
        causes: ["The load resistor value may be too low, or a wiring issue is dropping voltage."],
        troubleshooting: ["Measure the load resistor value out of circuit.", "Check for corroded or loose connections along the load path."],
        symptoms: [{ key: "dcOutput", type: "low" }, { key: "acInput", type: "inRange" }]
      }
    ],
    learn: {
      principle: "The diode conducts only when forward biased, passing one half of each AC cycle to the load and blocking the other. The result is a pulsing DC waveform.",
      expectedBehavior: "For a 12 V rms AC input, expect roughly 4.5–5.5 V average DC output and a forward drop of about 0.6–0.7 V across the diode when conducting.",
      commonFaults: ["Open diode", "Shorted diode", "Reversed diode", "Loose connections"],
      method: "Confirm AC is actually present at the input before suspecting the diode — a missing input looks identical to a failed diode at the output."
    }
  },

  fullwave: {
    name: "Full-Wave Rectifier",
    description: "A four-diode bridge that rectifies both halves of the AC cycle for a smoother DC output.",
    difficulty: "Intermediate",
    components: ["AC Source", "Diode Bridge (4×)", "Load Resistor"],
    supplyText: "12 V AC (rms)",
    fields: [
      { key: "acInput", label: "AC Input (rms)", unit: "V", expectedMin: 11, expectedMax: 13, expectedText: "11 – 13 V", validMin: 0, validMax: 240 },
      { key: "dcOutput", label: "DC Output (avg)", unit: "V", expectedMin: 9, expectedMax: 10.5, expectedText: "9 – 10.5 V", validMin: 0, validMax: 240 },
      { key: "ripple", label: "Ripple Indication", unit: "mV", expectedMin: 100, expectedMax: 500, expectedText: "100 – 500 mV", validMin: 0, validMax: 20000 }
    ],
    faults: [
      {
        id: "one-diode-open", name: "One Diode Open (Bridge Running Half-Wave)",
        causes: ["One diode in the bridge has failed open, so only one half-cycle is rectified."],
        troubleshooting: ["Measure across the output — a halved DC level with doubled ripple points to one bad diode.", "Test each bridge diode individually with a diode-test meter.", "Replace the faulty diode."],
        symptoms: [{ key: "dcOutput", type: "low" }, { key: "ripple", type: "high" }]
      },
      {
        id: "wrong-orientation", name: "Incorrect Diode Orientation",
        causes: ["One or more bridge diodes are installed backwards, disrupting the rectification path."],
        troubleshooting: ["Check each diode's band orientation against the bridge diagram.", "Correct any reversed diodes and re-test."],
        symptoms: [{ key: "dcOutput", type: "zero" }, { key: "acInput", type: "inRange" }]
      },
      {
        id: "open-connection", name: "Open Connection",
        causes: ["A wire from the transformer/AC source to the bridge is broken."],
        troubleshooting: ["Check continuity from the AC source to the bridge input pins.", "Reseat all connections."],
        symptoms: [{ key: "acInput", type: "zero" }, { key: "dcOutput", type: "zero" }]
      },
      {
        id: "shorted-diode", name: "Shorted Diode",
        causes: ["A bridge diode has failed short, which can also load down the AC source."],
        troubleshooting: ["Power off and measure each diode out of circuit for a short.", "Check for a tripped fuse or overheating near the bridge.", "Replace the shorted diode."],
        symptoms: [{ key: "dcOutput", type: "zero" }, { key: "acInput", type: "inRange" }, { key: "ripple", type: "zero" }]
      },
      {
        id: "insufficient-filtering", name: "Excessive Ripple / Filtering Issue",
        causes: ["The smoothing stage after the bridge is missing or degraded, letting ripple through."],
        troubleshooting: ["Check for a filter capacitor across the output, if the design calls for one.", "Verify the capacitor's value and that it isn't open or reversed."],
        symptoms: [{ key: "ripple", type: "high" }, { key: "dcOutput", type: "inRange" }]
      }
    ],
    learn: {
      principle: "Four diodes arranged in a bridge conduct in complementary pairs, so current flows through the load in the same direction on both halves of the AC cycle.",
      expectedBehavior: "For a 12 V rms input, expect roughly 9–10.5 V average DC output with lower ripple than a half-wave design at the same load.",
      commonFaults: ["One diode open (looks like half-wave output)", "Wrong diode orientation", "Open connection", "Shorted diode"],
      method: "A DC output near half the expected value, with visibly higher ripple, is the classic signature of a single failed bridge diode rather than a total bridge failure."
    }
  },

  bjt: {
    name: "Common-Emitter BJT Amplifier",
    description: "A single-transistor voltage amplifier biased for class-A operation using a resistor divider.",
    difficulty: "Advanced",
    components: ["NPN BJT", "Bias Resistors", "Collector Resistor", "Emitter Resistor", "Vcc Supply"],
    supplyText: "12 V DC (Vcc)",
    fields: [
      { key: "vcc", label: "Supply Voltage (Vcc)", unit: "V", expectedMin: 11.5, expectedMax: 12.5, expectedText: "11.5 – 12.5 V", validMin: 0, validMax: 60 },
      { key: "baseVoltage", label: "Base Voltage", unit: "V", expectedMin: 1.9, expectedMax: 2.3, expectedText: "1.9 – 2.3 V", validMin: 0, validMax: 60 },
      { key: "collectorVoltage", label: "Collector Voltage", unit: "V", expectedMin: 5.5, expectedMax: 6.5, expectedText: "5.5 – 6.5 V", validMin: 0, validMax: 60 },
      { key: "emitterVoltage", label: "Emitter Voltage", unit: "V", expectedMin: 1.1, expectedMax: 1.5, expectedText: "1.1 – 1.5 V", validMin: 0, validMax: 60 },
      { key: "outputVoltage", label: "Output Signal Level", unit: "mV", expectedMin: 100, expectedMax: 500, expectedText: "100 – 500 mV", validMin: 0, validMax: 20000 }
    ],
    faults: [
      {
        id: "incorrect-bias", name: "Incorrect Biasing",
        causes: ["The base bias resistor divider is producing the wrong base voltage.", "This shifts the operating (Q) point away from mid-supply."],
        troubleshooting: ["Measure both bias resistors out of circuit.", "Recompute the expected base voltage from the divider values.", "Replace any resistor that doesn't match spec."],
        symptoms: [{ key: "baseVoltage", type: "outOfRange" }, { key: "collectorVoltage", type: "outOfRange" }]
      },
      {
        id: "open-transistor", name: "Open Transistor (Junction Open)",
        causes: ["The base-emitter or collector-emitter junction has failed open, so the transistor cannot conduct."],
        troubleshooting: ["Test the transistor out of circuit with a multimeter's diode-test function on both B-E and B-C junctions.", "Replace the transistor if a junction shows no conduction."],
        symptoms: [{ key: "collectorVoltage", type: "high" }, { key: "outputVoltage", type: "zero" }]
      },
      {
        id: "shorted-transistor", name: "Shorted Transistor (C-E Short)",
        causes: ["The collector-emitter junction has failed short, pulling the collector down toward the emitter voltage."],
        troubleshooting: ["Power off and test collector-to-emitter resistance out of circuit.", "Replace the transistor if it reads near 0 Ω."],
        symptoms: [{ key: "collectorVoltage", type: "zero" }, { key: "outputVoltage", type: "zero" }]
      },
      {
        id: "wrong-rc", name: "Incorrect Collector Resistor",
        causes: ["Rc is a different value than designed, shifting the collector voltage away from mid-supply."],
        troubleshooting: ["Measure Rc out of circuit and compare to the design value.", "Replace with the correct resistor."],
        symptoms: [{ key: "collectorVoltage", type: "outOfRange" }, { key: "baseVoltage", type: "inRange" }]
      },
      {
        id: "missing-ground", name: "Missing Ground Connection",
        causes: ["The emitter resistor or circuit common is not properly grounded, letting the emitter node float high."],
        troubleshooting: ["Check the ground return path with the circuit powered off.", "Verify continuity between circuit common and the supply's negative terminal."],
        symptoms: [{ key: "emitterVoltage", type: "high" }, { key: "vcc", type: "inRange" }]
      }
    ],
    learn: {
      principle: "The base bias resistors set a fixed base voltage, which sets the emitter current and, through the collector resistor, the collector voltage — ideally near mid-supply for maximum symmetrical output swing.",
      expectedBehavior: "With Vcc = 12 V, expect the base near 2 V, the emitter about 0.7 V below that, and the collector sitting near 6 V (mid-supply) with no input signal applied.",
      commonFaults: ["Incorrect bias", "Open or shorted transistor", "Wrong collector resistor", "Missing ground"],
      method: "Work from Vcc toward ground: if the base voltage is correct but the collector is not, suspect Rc or the transistor. If the base voltage itself is wrong, suspect the bias resistors."
    }
  },

  mosfet: {
    name: "Common-Source MOSFET Amplifier",
    description: "A single N-channel MOSFET voltage amplifier with resistor gate biasing and a grounded source.",
    difficulty: "Advanced",
    components: ["N-Channel MOSFET", "Gate Bias Resistors", "Drain Resistor", "Vdd Supply"],
    supplyText: "12 V DC (Vdd)",
    fields: [
      { key: "vdd", label: "Supply Voltage (Vdd)", unit: "V", expectedMin: 11.5, expectedMax: 12.5, expectedText: "11.5 – 12.5 V", validMin: 0, validMax: 60 },
      { key: "gateVoltage", label: "Gate Voltage", unit: "V", expectedMin: 2.3, expectedMax: 2.7, expectedText: "2.3 – 2.7 V", validMin: 0, validMax: 60 },
      { key: "drainVoltage", label: "Drain Voltage", unit: "V", expectedMin: 5.5, expectedMax: 6.5, expectedText: "5.5 – 6.5 V", validMin: 0, validMax: 60 },
      { key: "sourceVoltage", label: "Source Voltage", unit: "V", expectedMin: 0, expectedMax: 0.2, expectedText: "0 – 0.2 V", validMin: 0, validMax: 60 },
      { key: "outputVoltage", label: "Output Signal Level", unit: "mV", expectedMin: 100, expectedMax: 500, expectedText: "100 – 500 mV", validMin: 0, validMax: 20000 }
    ],
    faults: [
      {
        id: "incorrect-bias-mosfet", name: "Incorrect Gate Biasing",
        causes: ["The gate bias resistor network is producing the wrong gate voltage, shifting the Q-point."],
        troubleshooting: ["Measure both gate bias resistors out of circuit.", "Recompute expected gate voltage from the divider.", "Replace any out-of-spec resistor."],
        symptoms: [{ key: "gateVoltage", type: "outOfRange" }, { key: "drainVoltage", type: "outOfRange" }]
      },
      {
        id: "mosfet-open", name: "MOSFET Fault (Open Channel)",
        causes: ["The MOSFET is not conducting — possible gate-oxide or channel failure."],
        troubleshooting: ["Verify gate voltage is above threshold first.", "Test the MOSFET out of circuit if a suitable tester is available.", "Replace the MOSFET if the channel shows no conduction with adequate gate voltage."],
        symptoms: [{ key: "drainVoltage", type: "high" }, { key: "outputVoltage", type: "zero" }]
      },
      {
        id: "mosfet-short", name: "MOSFET Fault (Shorted Drain-Source)",
        causes: ["The drain-source channel has failed short, pulling drain voltage down toward the source."],
        troubleshooting: ["Power off and measure drain-to-source resistance out of circuit.", "Replace the MOSFET if it reads near 0 Ω."],
        symptoms: [{ key: "drainVoltage", type: "zero" }, { key: "outputVoltage", type: "zero" }]
      },
      {
        id: "wrong-rd", name: "Incorrect Drain Resistor",
        causes: ["Rd is a different value than designed, shifting the drain voltage away from mid-supply."],
        troubleshooting: ["Measure Rd out of circuit and compare to the design value.", "Replace with the correct resistor."],
        symptoms: [{ key: "drainVoltage", type: "outOfRange" }, { key: "gateVoltage", type: "inRange" }]
      },
      {
        id: "missing-ground-mosfet", name: "Missing Ground Connection",
        causes: ["The source or circuit common is not properly grounded, letting the source node float."],
        troubleshooting: ["Check the ground return path with the circuit powered off.", "Verify continuity between circuit common and the supply's negative terminal."],
        symptoms: [{ key: "sourceVoltage", type: "high" }, { key: "vdd", type: "inRange" }]
      },
      {
        id: "supply-problem-mosfet", name: "Supply Problem",
        causes: ["Vdd is missing, low, or disconnected."],
        troubleshooting: ["Measure directly at the supply terminals.", "Check the supply is switched on and set to the correct voltage."],
        symptoms: [{ key: "vdd", type: "zero" }, { key: "drainVoltage", type: "zero" }]
      }
    ],
    learn: {
      principle: "A resistor network sets the gate voltage above the MOSFET's threshold, controlling drain current and, through the drain resistor, the drain voltage — ideally near mid-supply for symmetric swing.",
      expectedBehavior: "With Vdd = 12 V, expect the gate near 2.5 V, the source close to 0 V (grounded configuration), and the drain sitting near 6 V with no input signal applied.",
      commonFaults: ["Incorrect gate bias", "Open or shorted MOSFET", "Wrong drain resistor", "Missing ground", "Supply problem"],
      method: "If the gate voltage is correct but drain voltage is not, suspect Rd or the MOSFET itself. If gate voltage is already wrong, look at the bias resistors first."
    }
  },

  timer555: {
    name: "555 Timer Astable Circuit",
    description: "A 555 IC configured in astable mode to generate a continuous square-wave output.",
    difficulty: "Intermediate",
    components: ["555 Timer IC", "Timing Resistors (R1, R2)", "Timing Capacitor", "Supply"],
    supplyText: "9 V DC",
    fields: [
      { key: "supplyVoltage", label: "Supply Voltage", unit: "V", expectedMin: 8.5, expectedMax: 9.5, expectedText: "8.5 – 9.5 V", validMin: 0, validMax: 30 },
      { key: "outputVoltage", label: "Output High Level", unit: "V", expectedMin: 8, expectedMax: 9, expectedText: "8 – 9 V", validMin: 0, validMax: 30 },
      { key: "frequency", label: "Output Frequency", unit: "Hz", expectedMin: 900, expectedMax: 1100, expectedText: "900 – 1100 Hz", validMin: 0, validMax: 1000000 },
      { key: "dutyCycle", label: "Duty Cycle", unit: "%", expectedMin: 60, expectedMax: 70, expectedText: "60 – 70 %", validMin: 0, validMax: 100 }
    ],
    faults: [
      {
        id: "wrong-r-timing", name: "Incorrect Timing Resistor",
        causes: ["R1 or R2 is a different value than designed, shifting frequency and duty cycle."],
        troubleshooting: ["Measure R1 and R2 out of circuit.", "Compare against the design values.", "Replace any resistor that doesn't match."],
        symptoms: [{ key: "frequency", type: "outOfRange" }, { key: "outputVoltage", type: "inRange" }]
      },
      {
        id: "wrong-capacitor", name: "Incorrect Timing Capacitor",
        causes: ["The timing capacitor value differs from the design, which changes frequency significantly."],
        troubleshooting: ["Measure the capacitor's value if a capacitance meter is available.", "Check for the correct marked value.", "Replace with the specified capacitor."],
        symptoms: [{ key: "frequency", type: "outOfRange" }, { key: "dutyCycle", type: "inRange" }]
      },
      {
        id: "wiring-error", name: "Wiring Error",
        causes: ["A pin connection (threshold, trigger, discharge, or control voltage) is miswired."],
        troubleshooting: ["Check each 555 pin against the standard astable configuration diagram.", "Verify the timing network is connected to the correct pins.", "Correct any miswired pin and re-test."],
        symptoms: [{ key: "outputVoltage", type: "zero" }, { key: "supplyVoltage", type: "inRange" }]
      },
      {
        id: "no-supply-555", name: "No Supply Voltage",
        causes: ["The supply is off, disconnected, or the battery is depleted."],
        troubleshooting: ["Measure directly at the supply pins of the IC.", "Check the supply source and its connections."],
        symptoms: [{ key: "supplyVoltage", type: "zero" }, { key: "outputVoltage", type: "zero" }, { key: "frequency", type: "zero" }]
      },
      {
        id: "ic-fault", name: "IC Fault",
        causes: ["The 555 timer chip itself has failed internally."],
        troubleshooting: ["Confirm supply voltage and all external wiring are correct first.", "Swap in a known-good 555 IC to confirm.", "Check the IC hasn't overheated or been damaged by reversed supply."],
        symptoms: [{ key: "outputVoltage", type: "zero" }, { key: "supplyVoltage", type: "inRange" }, { key: "frequency", type: "zero" }]
      }
    ],
    learn: {
      principle: "The 555 charges and discharges the timing capacitor through R1 and R2 between two internal comparator thresholds, producing a continuous square wave whose frequency depends on R1, R2, and C.",
      expectedBehavior: "With typical astable component values, expect an output frequency near 1 kHz with a duty cycle above 50% (astable 555 output is always high longer than low unless a diode is added).",
      commonFaults: ["Wrong timing resistor or capacitor", "Wiring error on control pins", "No supply", "Internal IC fault"],
      method: "If frequency is off but the output is otherwise clean, suspect the timing network (R1, R2, C). If there's no output at all, check supply and pin wiring before suspecting the IC."
    }
  },

  rcfilter: {
    name: "RC Low-Pass Filter",
    description: "A single resistor and capacitor that attenuate signals above the filter's cutoff frequency.",
    difficulty: "Beginner",
    components: ["Resistor (R)", "Capacitor (C)", "AC Source"],
    supplyText: "5 V AC test signal",
    fields: [
      { key: "inputVoltage", label: "Input Voltage", unit: "V", expectedMin: 4.8, expectedMax: 5.2, expectedText: "4.8 – 5.2 V", validMin: 0, validMax: 60 },
      { key: "outputVoltage", label: "Output Voltage (at cutoff)", unit: "V", expectedMin: 3.3, expectedMax: 3.7, expectedText: "3.3 – 3.7 V", validMin: 0, validMax: 60 },
      { key: "frequency", label: "Test Frequency", unit: "Hz", expectedMin: 950, expectedMax: 1050, expectedText: "950 – 1050 Hz", validMin: 0, validMax: 1000000 },
      { key: "resistorValue", label: "Resistor (R)", unit: "Ω", expectedMin: 950, expectedMax: 1050, expectedText: "950 – 1050 Ω", validMin: 0, validMax: 10000000 },
      { key: "capacitorValue", label: "Capacitor (C)", unit: "µF", expectedMin: 0.15, expectedMax: 0.18, expectedText: "0.15 – 0.18 µF", validMin: 0, validMax: 100000 }
    ],
    faults: [
      {
        id: "wrong-resistor-rc", name: "Incorrect Resistor Value",
        causes: ["R differs from the design value, shifting the cutoff frequency and the output level at the test frequency."],
        troubleshooting: ["Measure R out of circuit.", "Compare against the design value.", "Replace with the correct resistor."],
        symptoms: [{ key: "outputVoltage", type: "outOfRange" }, { key: "resistorValue", type: "outOfRange" }]
      },
      {
        id: "wrong-capacitor-rc", name: "Incorrect Capacitor Value",
        causes: ["C differs from the design value, shifting the cutoff frequency."],
        troubleshooting: ["Measure C with a capacitance meter if available.", "Check the marked value against the design.", "Replace with the correct capacitor."],
        symptoms: [{ key: "outputVoltage", type: "outOfRange" }, { key: "capacitorValue", type: "outOfRange" }, { key: "resistorValue", type: "inRange" }]
      },
      {
        id: "open-connection-rc", name: "Open Connection",
        causes: ["A wire from the source, through R, to the output node is broken."],
        troubleshooting: ["Check continuity from source to R to the output node.", "Reseat all connections."],
        symptoms: [{ key: "outputVoltage", type: "zero" }, { key: "inputVoltage", type: "inRange" }]
      },
      {
        id: "incorrect-frequency", name: "Test Performed Off the Cutoff Frequency",
        causes: ["The measurement was taken at a frequency far from the intended cutoff, so the output ratio looks abnormal even with good components."],
        troubleshooting: ["Confirm the signal generator frequency matches the intended test point.", "Recalculate expected attenuation for the actual test frequency if it was intentional."],
        symptoms: [{ key: "outputVoltage", type: "outOfRange" }, { key: "frequency", type: "outOfRange" }]
      },
      {
        id: "connection-problem-rc", name: "Component Connection Problem",
        causes: ["The source itself isn't reaching the filter — check upstream of R."],
        troubleshooting: ["Measure directly at the source terminals.", "Check the connection from the source to the filter input."],
        symptoms: [{ key: "inputVoltage", type: "zero" }, { key: "outputVoltage", type: "zero" }]
      }
    ],
    learn: {
      principle: "The capacitor's impedance falls as frequency rises, so more of the input signal is dropped across R and less appears at the output as frequency increases past the cutoff point, fc = 1 / (2πRC).",
      expectedBehavior: "At the cutoff frequency, output amplitude should be about 70.7% of the input (the −3 dB point) — roughly 3.3–3.7 V for a 5 V input.",
      commonFaults: ["Wrong resistor or capacitor value", "Open connection", "Testing at the wrong frequency"],
      method: "If R and C both measure correctly but the output ratio is still off, double check the test frequency actually matches the intended cutoff before suspecting the components."
    }
  }
};

/* ---------------------------------------------------------
   3. SCHEMATIC RENDERER
   Builds a simple left-to-right block schematic from a
   circuit's component list — no external image assets.
   --------------------------------------------------------- */
function iconForComponent(label) {
  const l = label.toLowerCase();
  if (l.includes("led")) {
    return `<g><polygon points="0,-12 0,12 18,0" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="18" y1="-12" x2="18" y2="12" stroke="currentColor" stroke-width="1.6"/><line x1="22" y1="-6" x2="27" y2="-11" stroke="currentColor" stroke-width="1.2"/><line x1="22" y1="1" x2="27" y2="-4" stroke="currentColor" stroke-width="1.2"/></g>`;
  }
  if (l.includes("diode") || l.includes("bridge")) {
    return `<g><polygon points="0,-10 0,10 16,0" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="16" y1="-10" x2="16" y2="10" stroke="currentColor" stroke-width="1.6"/></g>`;
  }
  if (l.includes("resistor")) {
    return `<path d="M0,0 h6 l4,-8 l6,16 l6,-16 l6,16 l6,-16 l4,8 h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`;
  }
  if (l.includes("capacitor")) {
    return `<g><line x1="0" y1="-14" x2="0" y2="14" stroke="currentColor" stroke-width="2"/><line x1="8" y1="-14" x2="8" y2="14" stroke="currentColor" stroke-width="2"/></g>`;
  }
  if (l.includes("mosfet") || l.includes("bjt") || l.includes("transistor")) {
    return `<g><circle cx="10" cy="0" r="16" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="2" y1="-10" x2="2" y2="10" stroke="currentColor" stroke-width="2"/><line x1="2" y1="-6" x2="16" y2="-12" stroke="currentColor" stroke-width="1.6"/><line x1="2" y1="6" x2="16" y2="12" stroke="currentColor" stroke-width="1.6"/></g>`;
  }
  if (l.includes("555") || l.includes("ic")) {
    return `<g><rect x="-8" y="-14" width="36" height="28" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><text x="10" y="4" font-size="9" text-anchor="middle" fill="currentColor" font-family="monospace">555</text></g>`;
  }
  if (l.includes("ac source") || l.includes("supply") || l.includes("vcc") || l.includes("vdd")) {
    return `<g><circle cx="10" cy="0" r="14" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2,0 q4,-8 8,0 q4,8 8,0" fill="none" stroke="currentColor" stroke-width="1.4"/></g>`;
  }
  return `<rect x="-6" y="-12" width="28" height="24" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/>`;
}

function buildSchematicSVG(circuit) {
  const items = circuit.components;
  const spacing = 100;
  const startX = 50;
  const y = 45;
  const width = Math.max(320, startX * 2 + spacing * (items.length - 1) + 60);
  let wires = "";
  let nodes = "";

  items.forEach((label, i) => {
    const x = startX + i * spacing;
    if (i < items.length - 1) {
      wires += `<line x1="${x + 22}" y1="${y}" x2="${x + spacing - 22}" y2="${y}" stroke="currentColor" stroke-width="1.4" opacity="0.55"/>`;
    }
    nodes += `<g transform="translate(${x},${y})" class="schem-part">${iconForComponent(label)}</g>`;
    nodes += `<text x="${x + 10}" y="${y + 34}" font-size="9.5" text-anchor="middle" fill="currentColor" opacity="0.75" font-family="'IBM Plex Mono', monospace">${label}</text>`;
  });

  const lastX = startX + (items.length - 1) * spacing;
  wires += `<line x1="${lastX + 22}" y1="${y}" x2="${lastX + 55}" y2="${y}" stroke="currentColor" stroke-width="1.4" opacity="0.55"/>`;
  const gx = lastX + 60;
  nodes += `<g transform="translate(${gx},${y})" opacity="0.75"><line x1="0" y1="-10" x2="0" y2="0" stroke="currentColor" stroke-width="1.4"/><line x1="-9" y1="0" x2="9" y2="0" stroke="currentColor" stroke-width="1.6"/><line x1="-6" y1="4" x2="6" y2="4" stroke="currentColor" stroke-width="1.3"/><line x1="-3" y1="8" x2="3" y2="8" stroke="currentColor" stroke-width="1"/></g>`;

  return `<svg viewBox="0 0 ${width + 30} 100" xmlns="http://www.w3.org/2000/svg" class="schematic-svg">${wires}${nodes}</svg>`;
}

/* ---------------------------------------------------------
   4. DIAGNOSTIC ENGINE
   --------------------------------------------------------- */
function evalSymptom(symptom, value, field) {
  const tol = symptom.tol !== undefined ? symptom.tol : Math.max((field.expectedMax - field.expectedMin) * 0.15, 0.05);
  switch (symptom.type) {
    case "zero": return Math.abs(value) <= (symptom.tol !== undefined ? symptom.tol : field.expectedMin * 0.1 + 0.05);
    case "low": return value < field.expectedMin;
    case "high": return value > field.expectedMax;
    case "inRange": return value >= field.expectedMin && value <= field.expectedMax;
    case "outOfRange": return value < field.expectedMin || value > field.expectedMax;
    case "near": return Math.abs(value - symptom.target) <= tol;
    default: return false;
  }
}

function fieldIsNormal(field, value) {
  return value >= field.expectedMin && value <= field.expectedMax;
}

/**
 * calculateFaultScore
 * Returns { matched, total, confidence(0-100) } for one fault
 * given the measured values object and the circuit's field list.
 */
function calculateFaultScore(fault, measured, fieldsByKey) {
  let matched = 0;
  fault.symptoms.forEach((s) => {
    const field = fieldsByKey[s.key];
    const value = measured[s.key];
    if (field && value !== undefined && evalSymptom(s, value, field)) matched += 1;
  });
  const total = fault.symptoms.length;
  return { matched, total, confidence: total ? Math.round((matched / total) * 100) : 0 };
}

/**
 * diagnoseCircuit
 * Core entry point: given a circuit id and a measured-values
 * object, returns a full diagnosis result.
 */
function diagnoseCircuit(circuitId, measured) {
  const circuit = CIRCUITS[circuitId];
  const fieldsByKey = {};
  circuit.fields.forEach((f) => { fieldsByKey[f.key] = f; });

  const allNormal = circuit.fields.every((f) => fieldIsNormal(f, measured[f.key]));

  const ranked = circuit.faults
    .map((fault) => ({ fault, ...calculateFaultScore(fault, measured, fieldsByKey) }))
    .filter((r) => r.matched > 0)
    .sort((a, b) => b.confidence - a.confidence || b.matched - a.matched)
    .slice(0, 3);

  let status;
  if (allNormal) {
    status = "normal";
  } else if (ranked.length && ranked[0].confidence >= 60) {
    status = "fault";
  } else {
    status = "warning";
  }

  return { circuit, fieldsByKey, allNormal, status, ranked, measured };
}

/* ---------------------------------------------------------
   5. UI WIRING
   --------------------------------------------------------- */
let currentCircuitId = null;
let lastResult = null;

const el = (id) => document.getElementById(id);

/* ---- Navigation ---- */
function goTo(sectionName) {
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  const target = el("section-" + sectionName);
  if (target) target.classList.add("active");

  document.querySelectorAll(".navlink").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.nav === sectionName);
  });

  el("mobileNavPanel").classList.remove("open");
  el("mobileNavPanel").hidden = true;
  window.scrollTo({ top: 0, behavior: "smooth" });

  if (sectionName === "history") renderHistory();
  if (sectionName === "circuits") renderCircuitGrid(el("circuitSearch").value);
  if (sectionName === "learn") renderLearn();
  if (sectionName === "dashboard") renderDashboardHistory();
}

document.querySelectorAll("[data-nav]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const section = btn.dataset.nav;
    if (btn.dataset.requiresCircuit && !currentCircuitId) {
      showToast("Pick a circuit first from the library.");
      goTo("circuits");
      return;
    }
    goTo(section);
  });
});

el("mobileNavToggle").addEventListener("click", () => {
  const panel = el("mobileNavPanel");
  panel.hidden = !panel.hidden;
  panel.classList.toggle("open", !panel.hidden);
});

/* ---- Theme toggle ---- */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  el("themeIconMoon").style.display = theme === "dark" ? "block" : "none";
  el("themeIconSun").style.display = theme === "light" ? "block" : "none";
  safeStorage.set("circuitdx_theme", theme);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  applyTheme(current === "dark" ? "light" : "dark");
}
el("themeToggle").addEventListener("click", toggleTheme);
applyTheme(safeStorage.get("circuitdx_theme") || "dark");

/* ---- Toast ---- */
let toastTimer = null;
function showToast(msg) {
  const t = el("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---- Dashboard ---- */
function initDashboardStats() {
  const circuitCount = Object.keys(CIRCUITS).length;
  const faultCount = Object.values(CIRCUITS).reduce((sum, c) => sum + c.faults.length, 0);
  el("statCircuits").textContent = circuitCount;
  el("statFaults").textContent = faultCount;
}

el("howItWorksBtn").addEventListener("click", () => {
  const box = el("howItWorks");
  box.hidden = !box.hidden;
});

/* Animate the hero readout number for a bit of bench-instrument life */
function animateHeroReadout() {
  const target = el("heroReadoutVal");
  if (!target) return;
  let val = 4.6 + Math.random() * 0.6;
  setInterval(() => {
    val += (Math.random() - 0.5) * 0.08;
    val = Math.max(4.4, Math.min(5.3, val));
    target.textContent = val.toFixed(2);
  }, 900);
}

/* ---- Circuit grid / search ---- */
function renderCircuitGrid(filterText) {
  const grid = el("circuitGrid");
  const q = (filterText || "").trim().toLowerCase();
  grid.innerHTML = "";
  let visibleCount = 0;

  Object.entries(CIRCUITS).forEach(([id, c]) => {
    const haystack = (c.name + " " + c.description + " " + c.components.join(" ")).toLowerCase();
    if (q && !haystack.includes(q)) return;
    visibleCount += 1;

    const card = document.createElement("article");
    card.className = "circuit-card";
    const icons = {
      led: "◈", divider: "÷", halfwave: "⌁", fullwave: "⌁",
      bjt: "◉", mosfet: "▣", timer555: "555", rcfilter: "∿"
    };
    card.innerHTML = `
      <div class="card-visual">
        <span class="card-icon">${icons[id] || "⌘"}</span>
        <span class="circuit-code">${String(id).toUpperCase()}</span>
      </div>
      <div class="card-top">
        <div>
          <h3>${c.name}</h3>
          <span class="card-kicker">DIAGNOSTIC MODULE</span>
        </div>
        <span class="difficulty" data-level="${c.difficulty}">${c.difficulty}</span>
      </div>
      <p>${c.description}</p>
      <div class="card-components"><strong>COMPONENTS</strong><span>${c.components.join(" · ")}</span></div>
      <div class="card-footer">
        <span class="fault-count">${c.faults.length} fault patterns</span>
        <button class="btn btn-primary btn-small" data-diagnose="${id}">Open diagnosis <span>→</span></button>
      </div>
    `;
    grid.appendChild(card);
  });

  el("noResultsMsg").hidden = visibleCount !== 0;
}

el("circuitGrid").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-diagnose]");
  if (!btn) return;
  openDiagnosis(btn.dataset.diagnose);
});

el("circuitSearch").addEventListener("input", (e) => renderCircuitGrid(e.target.value));

/* ---- Diagnosis form ---- */
function openDiagnosis(circuitId) {
  currentCircuitId = circuitId;
  const circuit = CIRCUITS[circuitId];

  el("diagCircuitName").textContent = circuit.name;
  el("diagCircuitDesc").textContent = circuit.description;
  el("diagComponents").textContent = circuit.components.join(", ");
  el("diagSupply").textContent = circuit.supplyText;
  el("diagSchematic").innerHTML = buildSchematicSVG(circuit);

  const form = el("measurementForm");
  form.innerHTML = "";
  circuit.fields.forEach((f) => {
    const group = document.createElement("div");
    group.className = "field-group";
    group.innerHTML = `
      <label for="field-${f.key}">${f.label} <span style="color:var(--text-faint)">(expected ${f.expectedText})</span></label>
      <div class="input-with-unit">
        <input type="number" step="any" id="field-${f.key}" name="${f.key}" placeholder="0" />
        <span class="unit">${f.unit}</span>
      </div>
      <p class="field-error" id="error-${f.key}"></p>
    `;
    form.appendChild(group);
  });

  el("formError").hidden = true;
  goTo("diagnosis");
}

el("backToCircuits").addEventListener("click", () => goTo("circuits"));
el("clearFormBtn").addEventListener("click", () => {
  const circuit = CIRCUITS[currentCircuitId];
  circuit.fields.forEach((f) => {
    el(`field-${f.key}`).value = "";
    el(`field-${f.key}`).classList.remove("invalid");
    el(`error-${f.key}`).classList.remove("show");
  });
  el("formError").hidden = true;
});

/**
 * validateInputs
 * Returns { valid, values, firstErrorMsg }
 */
function validateInputs(circuit) {
  let valid = true;
  let firstErrorMsg = "";
  const values = {};

  circuit.fields.forEach((f) => {
    const input = el(`field-${f.key}`);
    const errorEl = el(`error-${f.key}`);
    const raw = input.value.trim();
    input.classList.remove("invalid");
    errorEl.classList.remove("show");

    if (raw === "") {
      valid = false;
      input.classList.add("invalid");
      errorEl.textContent = `Enter a value for ${f.label}.`;
      errorEl.classList.add("show");
      if (!firstErrorMsg) firstErrorMsg = `Please fill in every measurement field.`;
      return;
    }

    const num = Number(raw);
    if (Number.isNaN(num) || !Number.isFinite(num)) {
      valid = false;
      input.classList.add("invalid");
      errorEl.textContent = "Enter a valid number.";
      errorEl.classList.add("show");
      if (!firstErrorMsg) firstErrorMsg = "One or more fields contain an invalid value.";
      return;
    }

    if (num < f.validMin || num > f.validMax) {
      valid = false;
      input.classList.add("invalid");
      errorEl.textContent = `Please enter a valid value between ${f.validMin} and ${f.validMax} ${f.unit}.`;
      errorEl.classList.add("show");
      if (!firstErrorMsg) firstErrorMsg = `Please enter a valid ${f.label.toLowerCase()} between ${f.validMin} and ${f.validMax} ${f.unit}.`;
      return;
    }

    values[f.key] = num;
  });

  return { valid, values, firstErrorMsg };
}

el("diagnoseBtn").addEventListener("click", () => {
  const circuit = CIRCUITS[currentCircuitId];
  const { valid, values, firstErrorMsg } = validateInputs(circuit);
  const formError = el("formError");

  if (!valid) {
    formError.textContent = firstErrorMsg || "Please correct the highlighted fields.";
    formError.hidden = false;
    return;
  }
  formError.hidden = true;

  const result = diagnoseCircuit(currentCircuitId, values);
  lastResult = result;
  displayResults(result);
  saveDiagnosis(result);
  goTo("results");
});

el("backToDiagnosis").addEventListener("click", () => goTo("diagnosis"));
el("diagnoseAnotherBtn").addEventListener("click", () => goTo("circuits"));
el("backToCircuitsFromResults").addEventListener("click", () => goTo("circuits"));

/* ---- Results rendering ---- */
function displayResults(result) {
  const { circuit, fieldsByKey, allNormal, status, ranked, measured } = result;

  const dot = el("statusDot");
  const text = el("statusText");
  const summary = el("statusSummary");
  dot.className = "status-dot " + status;

  if (status === "normal") {
    text.textContent = "🟢 Normal";
    summary.textContent = "All entered measurements are within the expected range for this circuit.";
  } else if (status === "warning") {
    text.textContent = "🟡 Warning";
    summary.textContent = "Some readings are outside the expected range, but no single fault pattern matches strongly. Review the candidates below.";
  } else {
    text.textContent = "🔴 Possible Fault";
    summary.textContent = "One or more readings point to a likely fault. This is the most probable cause, not a confirmed diagnosis.";
  }

  const tbody = document.querySelector("#measurementTable tbody");
  tbody.innerHTML = "";
  circuit.fields.forEach((f) => {
    const value = measured[f.key];
    const ok = fieldIsNormal(f, value);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${f.label}</td>
      <td>${f.expectedText}</td>
      <td>${value} ${f.unit}</td>
      <td class="status-cell"><span class="pill ${ok ? "ok" : "bad"}">${ok ? "Normal" : "Abnormal"}</span></td>
    `;
    tbody.appendChild(tr);
  });

  const faultsPanel = el("faultsPanel");
  const faultList = el("faultList");
  faultList.innerHTML = "";

  if (allNormal || ranked.length === 0) {
    faultsPanel.hidden = true;
  } else {
    faultsPanel.hidden = false;
    ranked.forEach((r, i) => {
      const card = document.createElement("div");
      card.className = "fault-card";
      card.innerHTML = `
        <div class="fault-card-top">
          <span class="fault-rank">#${i + 1}</span>
          <span class="fault-name">${r.fault.name}</span>
          <div class="confidence-track"><div class="confidence-fill" style="width:${r.confidence}%"></div></div>
          <span class="confidence-num">${r.confidence}%</span>
        </div>
        <h4>Possible causes</h4>
        <ul>${r.fault.causes.map((c) => `<li>${c}</li>`).join("")}</ul>
        <h4>Recommended troubleshooting</h4>
        <ol>${r.fault.troubleshooting.map((s) => `<li>${s}</li>`).join("")}</ol>
      `;
      faultList.appendChild(card);
    });
  }
}

/* ---- History (localStorage) ---- */
const HISTORY_KEY = "circuitdx_history";
const HISTORY_LIMIT = 50;

function loadHistory() {
  const raw = safeStorage.get(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveDiagnosis(result) {
  const history = loadHistory();
  const topFault = result.ranked[0];
  const entry = {
    circuitId: currentCircuitId,
    circuitName: result.circuit.name,
    timestamp: new Date().toISOString(),
    measured: result.measured,
    status: result.status,
    diagnosis: result.allNormal ? "Circuit appears normal" : (topFault ? topFault.fault.name : "No strong match"),
    confidence: result.allNormal ? null : (topFault ? topFault.confidence : null)
  };
  history.unshift(entry);
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
  safeStorage.set(HISTORY_KEY, JSON.stringify(history));
}

function clearHistory() {
  safeStorage.remove(HISTORY_KEY);
  renderHistory();
  renderDashboardHistory();
  showToast("Diagnosis history cleared.");
}

function formatHistoryDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function historyItemHTML(entry) {
  const confidenceText = entry.confidence !== null && entry.confidence !== undefined ? `<span class="conf">${entry.confidence}%</span>` : "";
  return `
    <div class="history-item">
      <div class="history-main">
        <span class="history-circuit">${entry.circuitName}</span>
        <span class="history-meta">${formatHistoryDate(entry.timestamp)}</span>
      </div>
      <div class="history-result">
        <div>${entry.diagnosis}</div>
        ${confidenceText}
      </div>
    </div>
  `;
}

function renderHistory() {
  const list = el("historyList");
  const history = loadHistory();
  list.innerHTML = history.map(historyItemHTML).join("");
  el("historyEmptyMsg").hidden = history.length !== 0;
}

function renderDashboardHistory() {
  const container = el("dashboardHistory");
  const history = loadHistory().slice(0, 5);
  if (history.length === 0) {
    container.innerHTML = `<p class="empty-msg" style="padding:12px 0;">No diagnoses yet — run one from the circuit library.</p>`;
    return;
  }
  container.innerHTML = history.map(historyItemHTML).join("");
}

el("clearHistoryBtn").addEventListener("click", clearHistory);
el("clearHistoryBtnDash").addEventListener("click", clearHistory);

/* ---- Learn section (accordion) ---- */
function renderLearn() {
  const container = el("learnAccordion");
  if (container.dataset.built === "true") return;
  container.dataset.built = "true";

  container.innerHTML = Object.entries(CIRCUITS).map(([id, c]) => `
    <div class="accordion-item" data-id="${id}">
      <button class="accordion-trigger">
        <span>${c.name}</span>
        <svg class="chev" viewBox="0 0 24 24" width="16" height="16"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="accordion-body">
        <dl>
          <dt>Working principle</dt><dd>${c.learn.principle}</dd>
          <dt>Main components</dt><dd>${c.components.join(", ")}</dd>
          <dt>Expected behavior</dt><dd>${c.learn.expectedBehavior}</dd>
          <dt>Common faults</dt><dd><ul>${c.learn.commonFaults.map((f) => `<li>${f}</li>`).join("")}</ul></dd>
          <dt>Basic troubleshooting method</dt><dd>${c.learn.method}</dd>
        </dl>
      </div>
    </div>
  `).join("");

  container.querySelectorAll(".accordion-trigger").forEach((trigger) => {
    trigger.addEventListener("click", () => {
      trigger.parentElement.classList.toggle("open");
    });
  });
}

/* ---- Init ---- */
initDashboardStats();
renderDashboardHistory();
renderCircuitGrid("");
animateHeroReadout();
