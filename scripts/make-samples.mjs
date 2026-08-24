/**
 * Generates the test fixtures in samples/.
 *
 * Run with: node scripts/make-samples.mjs
 *
 * The awkward cases matter more than the happy ones — a suite where every file is
 * clean tells you nothing about the failure modes the brief actually asks about.
 * Every fixture below has a stated reason to exist.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";

const OUT = join(import.meta.dirname, "..", "samples");
mkdirSync(OUT, { recursive: true });

const write = (name, content) => {
  writeFileSync(join(OUT, name), content);
  console.log(`  ${name}`);
};

console.log("Writing samples:");

// --- Ranking: clean CSV, every field populated ------------------------------
write(
  "ranking-world-tour.csv",
  `Rank,Athlete,Country,Points
1,Neeraj Chopra,India,1455
2,Jakub Vadlejch,Czechia,1402
3,Julian Weber,Germany,1388
4,Anderson Peters,Grenada,1301
5,Arshad Nadeem,Pakistan,1290
`,
);

// --- Records: missing fields, so nulls must appear in the output -------------
// Two rows deliberately omit location and country. A correct extraction returns
// null for those; an incorrect one invents "India" from the surrounding context.
write(
  "records-national.csv",
  `Event,Athlete,Mark,Date,Venue,Country
100m,Amlan Borgohain,10.25,2022-09-24,Bengaluru,India
200m,Amlan Borgohain,20.52,2021-10-11,Patiala,India
Javelin Throw,Neeraj Chopra,89.94,2022-06-30,,
Long Jump,Jeswin Aldrin,8.42,2023-03-02,Bellary,
Marathon,Man Singh,2:12:38,2024-01-21,Mumbai,India
`,
);

// --- Athletes: multi-sheet workbook, plus a sheet with no athlete data -------
// Exercises the multiple-tables case and the per-sheet warning path.
{
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Name", "Country", "Date of Birth", "Gender", "Sport"],
      ["Neeraj Chopra", "India", "1997-12-24", "Male", "Athletics"],
      ["P.V. Sindhu", "India", "1995-07-05", "Female", "Badminton"],
      ["Mirabai Chanu", "India", "1994-08-08", "Female", "Weightlifting"],
      ["Nikhat Zareen", "India", "1996-06-14", "Female", "Boxing"],
    ]),
    "Squad",
  );

  // No date of birth column at all — those fields must come back null.
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Name", "Discipline"],
      ["Lovlina Borgohain", "Boxing"],
      ["Bhavani Devi", "Fencing"],
    ]),
    "Reserves",
  );

  // Nothing extractable — the parser should warn and skip rather than fail.
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([["Notes"], ["Travel arrangements to be confirmed."]]),
    "Admin",
  );

  XLSX.writeFile(wb, join(OUT, "athletes-squad.xlsx"));
  console.log("  athletes-squad.xlsx");
}

// --- Teams: rosters written as prose, not a table ---------------------------
write(
  "teams-hockey.txt",
  `HOCKEY — POOL B TEAM SHEETS
Sultan Azlan Shah Cup, Ipoh

India (Men's Hockey)
Goalkeeper: P.R. Sreejesh
Defenders: Harmanpreet Singh, Amit Rohidas, Jarmanpreet Singh
Midfielders: Manpreet Singh, Hardik Singh, Vivek Sagar Prasad
Forwards: Mandeep Singh, Abhishek, Lalit Upadhyay

Australia (Men's Hockey)
Goalkeeper: Andrew Charter
Defenders: Jeremy Hayward, Matthew Dawson
Midfielders: Aran Zalewski, Jake Whetton
Forwards: Blake Govers, Nathan Ephraums

Japan (Men's Hockey)
Squad not yet submitted.
`,
);

// --- Events: schedule with a venue missing ----------------------------------
write(
  "events-schedule.csv",
  `Event,Sport,Date,Venue,Participants
Men's 100m Final,Athletics,2026-07-15,National Stadium,"Amlan Borgohain, Gurindervir Singh, Manikanta Hoblidhar"
Women's Javelin Final,Athletics,2026-07-16,National Stadium,"Annu Rani, Shilpa Rani"
Mixed Team Badminton,Badminton,2026-07-18,,"P.V. Sindhu, Lakshya Sen"
Men's Hockey Semi-Final,Hockey,2026-07-19,Major Dhyan Chand Stadium,"India, Australia"
`,
);

// --- Mismatch case: an athletes file, for selecting "Teams" against ----------
// The brief's own example. Correct behaviour is success with an empty array.
write(
  "mismatch-athletes-only.txt",
  `INDIVIDUAL ENTRY LIST — SWIMMING

Srihari Nataraj, India, born 2000-01-16, Male
Sajan Prakash, India, born 1993-09-14, Male
Maana Patel, India, born 2000-03-18, Female

No relay squads or club teams are entered in this competition.
`,
);

// --- Duplicates: the same athlete listed twice with different completeness ---
write(
  "duplicates-mixed.csv",
  `Name,Country,DOB,Gender,Sport
Neeraj Chopra,India,1997-12-24,Male,Athletics
P.V. Sindhu,,1995-07-05,Female,Badminton
Neeraj Chopra,India,1997-12-24,Male,Athletics
P.V. Sindhu,India,1995-07-05,Female,
Nikhat Zareen,India,1996-06-14,Female,Boxing
`,
);

// --- Empty file: must produce EMPTY_FILE, not an empty extraction -----------
write("edge-empty.txt", "");

// --- Corrupt PDF: valid magic bytes, invalid structure ----------------------
// Passes the sniff check and fails in the parser, which is the path worth testing.
write("edge-corrupt.pdf", Buffer.from("%PDF-1.4\nthis is not a real pdf body\n%%EOF"));

// --- No relevant data: a valid, readable file about something else ----------
write(
  "edge-irrelevant.txt",
  `MINUTES OF THE FACILITIES SUB-COMMITTEE

The committee reviewed the resurfacing quotation for the warm-up track and
agreed to defer a decision until the next quarter. Catering arrangements for
the September meet were confirmed.
`,
);

console.log("\nDone. Run an extraction against any of these with:");
console.log(
  '  curl -F "file=@samples/ranking-world-tour.csv" -F "extractionType=ranking" http://localhost:3000/api/extract',
);
