# bomtool — KiCad BOM Merger

A single-file, fully static web tool (`bomtool.html`) that merges BOM CSVs exported
from KiCad into one consolidated parts order for a batch of different PCBs.
Open the file directly in a browser — there is no backend and no data ever leaves
the page (the only external reference is the Bootstrap CSS stylesheet).

**Use it online: <https://alacrity-education.github.io/bomtool/>** (deployed from
`main` via GitHub Pages; your CSVs are still processed entirely in your browser).

## Usage

1. Drag & drop BOM CSVs onto the left pane (or click it to browse).
   Each file appears as a card showing its row count, SPEC columns, and the
   distributors for which it carries at least one ordering code.
2. Set the **Quantity** on each card — how many of that board you are building.
   All quantities from that BOM are multiplied by it.
   Each card also has per-class **Headroom %** fields (default 100% = no extra):
   quantities of that class are scaled by the percentage and rounded up, so you
   can order spares of cheap parts. Classes: R (incl. potentiometer footprints),
   L, C, D, LED (LED footprints), Q, U, J, Other — decided by the reference
   prefix except where the footprint says otherwise. The merged table shows the
   class and applied headroom in gray next to each quantity (display only, not
   exported to the CSV).
3. Press **Generate**. The right pane shows the merged BOM, a per-supplier
   summary, and any warnings.
4. Press **Download CSV** to export the merged table.

Re-uploading a file with the same name replaces it (keeping its Quantity).
Changing any input after generating shows a "press Generate to refresh" hint.

## Configuration

Three arrays at the top of the `<script>` block:

| Array | Purpose | Default |
|---|---|---|
| `MANUFACTURER_KEYWORDS` | A column whose header *contains* any of these words (case-insensitive) is an ordering-code column. The array order is also the supplier preference order. | `TME, Farnell, Mouser, Digikey, LCSC, SOS, conex, protehno` |
| `IGNORED_COLUMNS` | Columns removed entirely (exact name, case-insensitive). | `Datasheet, Sim.Pins, Description` |
| `FOOTPRINT_SHORT_LETTERS` | KiCad library categories whose footprints are shortened, and the letter used. | `resistor→R, capacitor→C, inductor→L, diode→D, led→D` |
| `COMPONENT_CLASSES` | Component classes offered as per-PCB headroom fields. | `R, L, C, D, LED, Q, U, J, Other` |

## The merge process

### 1. Column decoding

For each CSV, the header row is classified per column:

- **Ordering code** — header contains a `MANUFACTURER_KEYWORDS` entry. The
  matched keyword becomes the column's canonical identity, so `TME`, `TME ID`
  and `Digikey ID` map to the `TME` / `Digikey` columns of the merged output.
- **Qty**, **Reference**, **Value**, **Footprint** — matched by name.
- **Ignored** — header is empty or listed in `IGNORED_COLUMNS`.
- **SPEC** — anything else (e.g. `Type`, `Inductance`). Non-empty SPEC cells
  act as additional specification during grouping.

### 2. Row parsing

- `Reference` is split on commas into designators. Each entry gets the ID
  `BOM_slug:designators` (slug = file name without `.csv`), e.g. `CANDU:R1,R2`.
- Footprints of R/C/L/D (incl. LED) library parts with an imperial size token
  are shortened at parse time: `Resistor_SMD:R_0603_1608Metric` → `R0603`,
  `Capacitor_SMD:C_1812_4532Metric` → `C1812`, `LED_SMD:LED_0603_1608Metric` →
  `D0603`. Anything without a recognizable category + size (SOT-23, chokes,
  THT radials…) is left untouched.
- Ordering codes are trimmed; per manufacturer, the first non-empty column wins.

### 3. Grouping (what counts as "the same part")

Entries from all uploaded BOMs are grouped by the key:

```
Value + Footprint + { non-empty SPEC name/value pairs }
```

Entries with the same Value/Footprint but a different SPEC set (more, fewer, or
different values) do **not** group. An empty SPEC cell is equivalent to the
column not existing at all.

### 4. Code-identity pass

Groups whose entries share an identical *(manufacturer, code)* pair are the same
physical part and are merged (union-find, so chains A~B~C collapse into one
cluster). Two flavors:

- **Silent** — the groups match on footprint and SPECs and only the Value label
  differs (`CAN1`…`CAN4` connectors, `100n` vs `100nF`). The shared code proves
  identity; Value is disregarded, no warning.
- **Warned** — the specification (footprint or SPECs) differs too. The groups
  still merge, but a warning names the entries carrying the shared code:
  `…have the same ordering code (LCSC "C2907172") but different specifications — merged`.

The same code string under *different* manufacturers never merges anything, and
entries with no codes can never bridge a Value difference.

### 5. Field merging per resulting line

- **Qty** — sum over all members of `ceil(entry Qty × board Quantity ×
  class headroom%)`, i.e. headroom rounds up per entry, per board.
- **References** — the member IDs, listed.
- **Value / Footprint / SPECs** — distinct values concatenated the same way as
  References (`; ` in the CSV, line breaks in the table).
- **Ordering codes**, per manufacturer column:
  - no codes → blank, no warning;
  - one distinct code → kept;
  - different codes → the code with the largest effective quantity wins, with a
    warning listing each side: `…have same specifications but different
    ordering codes: using LCSC "C222" (largest quantity)`.
- **Chosen supplier** — the first manufacturer in `MANUFACTURER_KEYWORDS` order
  whose merged code is non-empty; its cell is highlighted green. If none, all
  code cells stay blank and a `…has no ordering code` warning is emitted.

### 6. Validation warnings

- The number of designators in `Reference` must equal `Qty`
  (checked per entry, reported after generation).
- Malformed quantities and files missing Reference/Qty columns are reported.

### 7. Output

- Column order: `References, Qty, Value, Footprint, <manufacturer columns>,
  <SPEC columns>`.
- **Summary block** — per chosen supplier: *X components from Y (N lines)*,
  plus a "without ordering code" bucket.
- **Row highlighting** — red: no ordering code at all; yellow: involved in any
  warning (code conflict, spec-difference merge, designator mismatch).
- **Download CSV** — the table, RFC-4180 quoted.

## Development

`test-bomtool.js` extracts the `<script>` block from `bomtool.html` and runs the
pure merge logic against the example CSVs in `example/` plus synthetic edge
cases:

```
node test-bomtool.js
```

Keep it at 0 failures; update its expectations when the example CSVs or the
merge rules change.

## License

Developed by [Alacrity Education](https://alacrity.ro) and licensed under the
[GNU Affero General Public License v3](https://www.gnu.org/licenses/agpl-3.0.en.html)
(see `LICENSE`). If you modify or redistribute this tool — including offering it
or a derivative as a network service — the AGPL requires you to license your
version under AGPL-3.0 and give users access to the complete corresponding
source code, crediting the original source at
[github.com/Alacrity-Education/bomtool](https://github.com/Alacrity-Education/bomtool).
