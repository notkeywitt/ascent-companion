/**
 * Safety meeting topic catalog — a year-plus of weekly talks for THIS company.
 *
 * PURE data + pure functions only (no React, DB, or browser APIs), same rule as
 * src/lib/course.ts, so the picker can import it from anywhere.
 *
 * Why a hand-built list instead of a feed: the free toolbox-talk sites are
 * written for commercial work. Two thirds of a typical list is tower cranes,
 * highway work zones, confined-space entry and structural steel — none of which
 * a small residential builder on San Juan County ever does. Every topic here was
 * kept only if a 2-6 person remodel and custom-home crew could actually meet it
 * on a Monday morning. Season tags reflect the local weather, not a national one.
 *
 * Each topic carries its own talking points on purpose. The lead runs the
 * meeting off the iPad, often with no signal, so the talk has to work without
 * opening the source link. Points are the script; the link is the homework.
 *
 * WA rule citations were each verified against the WAC before being written
 * here. Do NOT add a rule number you have not read — a wrong citation in the
 * field is worse than none. Topics without a verified number carry no `rule`.
 *
 * Sources worth re-checking when this list is refreshed:
 *   - CPWR toolbox talks (free PDFs, EN + ES, added to on an ongoing basis)
 *     https://www.cpwr.com/research/research-to-practice-r2p/r2p-library/toolbox-talks/
 *   - WA L&I toolbox talks + the L&I-funded portal at toolboxtalks.info
 *     https://lni.wa.gov/safety-health/safety-training-materials/toolbox-talks
 *   - NAHB video toolbox talks (residential-specific, member/app access)
 *     https://www.nahb.org/advocacy/industry-issues/safety-and-health/safety-365/video-toolbox-talks
 */

export type SafetySeason = "spring" | "summer" | "fall" | "winter";

export const SAFETY_CATEGORIES = [
  "Falls",
  "Ladders & scaffolds",
  "Tools",
  "Electrical",
  "Dust & chemicals",
  "Body & lifting",
  "PPE",
  "Weather",
  "Site & housekeeping",
  "Driving & loads",
  "Health & wellbeing",
  "Planning & emergencies",
] as const;

export type SafetyCategory = (typeof SAFETY_CATEGORIES)[number];

export interface SafetyTopic {
  /** Stable slug. Never reuse one for a different talk. */
  id: string;
  /** Also the string written to the sheet, the Drive folder and the PDF. */
  title: string;
  category: SafetyCategory;
  /** The script — 4-6 points the lead can read straight off the screen. */
  points: string[];
  /** Seasons this is most worth raising. Omitted means any time of year. */
  seasons?: SafetySeason[];
  /** A WA rule this sits under. Only verified citations belong here. */
  rule?: string;
  /** Further reading. */
  source?: { label: string; url: string };
}

const CPWR = "https://www.cpwr.com/wp-content/uploads/";
const cpwr = (file: string, label = "CPWR toolbox talk") => ({ label, url: CPWR + file });
const wac = (cite: string, label: string) => ({
  label,
  url: `https://app.leg.wa.gov/wac/default.aspx?cite=${cite}`,
});

export const SAFETY_TOPICS: SafetyTopic[] = [
  /* ------------------------------------------------------------------ falls */
  {
    id: "roof-edge",
    title: "Working near a roof edge",
    category: "Falls",
    rule: "Chapter 296-880 WAC — fall protection at 4 ft, 10 ft for low-pitch roofing and structural erection",
    points: [
      "Decide the fall protection BEFORE anyone steps on the roof, not after.",
      "Pick the anchor first. It must hold one worker, and it must be structural — not a fascia, not a vent.",
      "Set lanyard length so you cannot reach the edge, or so you stop above the ground if you do fall.",
      "Steep pitch and low pitch are different rules. Ask which one this roof is.",
      "If the plan is 'be careful near the edge', there is no plan.",
    ],
    source: cpwr("TT-Preventing_Falls_Rooftops.pdf"),
  },
  {
    id: "holes-and-openings",
    title: "Holes, stairwells and skylights",
    category: "Falls",
    points: [
      "Every hole gets a cover the moment it is made. Not at the end of the day.",
      "A cover must hold twice the weight that could land on it, be secured down, and be marked.",
      "Loose plywood laid over a hole is a trap, not a cover.",
      "Skylights and light wells count as holes. So does a stair opening before the treads go in.",
      "If you remove a cover, you own that hole until you put it back.",
    ],
    source: cpwr("TT-Preventing_Falls_Through_Holes.pdf"),
  },
  {
    id: "guardrails",
    title: "Guardrails on decks and openings",
    category: "Falls",
    points: [
      "Top rail about 42 inches, a mid rail at half height, and a toe board where things can fall off.",
      "A guardrail has to take a shove. Push on it before you trust it.",
      "Deck framing, second-floor window openings and stair landings all need one.",
      "Do not remove a rail for material handling and leave it off.",
      "A rail is better than a harness, because it works whether or not someone remembered to clip in.",
    ],
    source: cpwr("TT-Falls_General_Protection_Awareness.pdf"),
  },
  {
    id: "harness-inspection",
    title: "Harness, lanyard and anchor checks",
    category: "Falls",
    points: [
      "Inspect the harness before every use. Webbing, stitching, D-ring, buckles.",
      "Any harness or lanyard that took a fall is done. Cut it up so it cannot come back.",
      "Check the fall clearance: lanyard, deceleration, your height, plus a safety margin.",
      "Watch for swing fall. Anchored off to the side, you swing into something.",
      "Have a rescue answer. A person hanging in a harness has minutes, not hours.",
    ],
  },
  {
    id: "wet-roof",
    title: "Wet, mossy or frosty roofs",
    category: "Falls",
    seasons: ["fall", "winter", "spring"],
    points: [
      "Frost and dew look dry from the ground. Test the surface before you commit.",
      "Moss on a north slope stays slick all day.",
      "Start roof work mid-morning in cold weather and let the sun burn the frost off.",
      "Wet plywood and wet OSB are two different surfaces. OSB is worse.",
      "Boot tread matters more than confidence. Check yours.",
    ],
  },
  {
    id: "falling-objects",
    title: "Dropped tools and falling material",
    category: "Falls",
    points: [
      "Nobody works directly under someone else. Reschedule or move.",
      "Tools near an edge get tethered or moved back.",
      "Do not stack material at a roof edge or on scaffold planks overnight.",
      "Call out before you drop or toss anything, then look first anyway.",
      "Hard hats are for this. Wear one when there is work overhead.",
    ],
    source: cpwr("TT-Preventing_Falling_Objects.pdf"),
  },

  /* ---------------------------------------------------- ladders & scaffolds */
  {
    id: "extension-ladders",
    title: "Extension ladder setup",
    category: "Ladders & scaffolds",
    points: [
      "One foot out for every four feet up. Toes at the feet, arms straight out, hands hit the rung.",
      "Three feet of ladder above the landing, and tie the top off.",
      "Level, solid footing. Not a sheet of plywood over mud, not a stack of blocks.",
      "Three points of contact, face the ladder, and carry tools on your belt or hoist them.",
      "Never stand on the top three rungs.",
    ],
    source: cpwr("TT-Falls_Extension_Ladders.pdf"),
  },
  {
    id: "step-ladders",
    title: "Step ladder habits",
    category: "Ladders & scaffolds",
    points: [
      "Spreaders fully open and locked. A leaning closed step ladder is the classic broken ankle.",
      "The top cap and the step below it are not steps.",
      "Do not overreach. Your belt buckle stays between the rails.",
      "Set it square to the work so you are not twisting.",
      "On a finished floor, watch for the ladder walking as you work.",
    ],
    source: cpwr("TT-Step_Ladders.pdf"),
  },
  {
    id: "ladder-inspection",
    title: "Ladder inspection and duty rating",
    category: "Ladders & scaffolds",
    points: [
      "Check rails, rungs, feet and the rope before you set it. Look for splits and missing feet.",
      "Duty rating covers you plus tools plus material. Type IA is 300 lb.",
      "A damaged ladder gets tagged and taken off the site, not leaned against the shop wall.",
      "No metal ladders near electrical work or power lines.",
      "Ladder feet caked in mud do not grip. Clean them.",
    ],
  },
  {
    id: "pump-jacks",
    title: "Pump jacks and plank staging",
    category: "Ladders & scaffolds",
    points: [
      "Poles braced to the wall at the spacing the maker calls for. Not what fits.",
      "Full planking, no gaps, and planks that overhang the support correctly.",
      "Guardrail and work bench arm go on. It takes five minutes.",
      "Know the load limit and count the bundles of siding you just set on it.",
      "Inspect the wall braces after a windy night before anyone climbs.",
    ],
    source: cpwr("TT-Preventing_Falls_Scaffolding.pdf"),
  },
  {
    id: "rolling-scaffold",
    title: "Rolling scaffold towers",
    category: "Ladders & scaffolds",
    points: [
      "Lock every caster before anyone gets on.",
      "Nobody rides the tower while it is moved. Get off, move it, get back on.",
      "Outriggers on when the tower is tall relative to its base.",
      "Full planking and guardrails, same as any other scaffold.",
      "Look at the floor you are rolling across. A cord, a threshold or a hole tips it.",
    ],
  },

  /* ------------------------------------------------------------------ tools */
  {
    id: "nail-guns",
    title: "Nail gun safety",
    category: "Tools",
    points: [
      "Sequential trip for anything but sheathing and decking. Bump fire causes most double-fires.",
      "Disconnect the air before you clear a jam, adjust the depth or hand it over.",
      "Know where your other hand is. Nails deflect off knots and follow the grain.",
      "Never carry it with a finger on the trigger.",
      "Report every nail-gun injury, including the ones that 'just went through the meat'.",
    ],
    source: cpwr("TT-Nail_Guns.pdf"),
  },
  {
    id: "circular-saws",
    title: "Circular saws and kickback",
    category: "Tools",
    points: [
      "The lower guard must snap back on its own. If it hangs up, fix the saw.",
      "Support the cut so the offcut falls free and the kerf does not close on the blade.",
      "Kickback comes from a pinched blade. Stand out of the line of the saw, not behind it.",
      "Watch the cord and your knee. Both live where the blade exits.",
      "Let the blade stop before you set the saw down.",
    ],
    source: cpwr("TT-Power_Saw_Safety.pdf"),
  },
  {
    id: "table-miter-saws",
    title: "Table saws and miter saws",
    category: "Tools",
    points: [
      "Riving knife and guard stay on. Push stick for anything narrow.",
      "Never freehand a rip. Fence or miter gauge, never both at once on a crosscut.",
      "On the miter saw, let the blade reach speed before it touches wood, and stop it before you lift.",
      "Keep hands outside the no-hands zone marked on the saw.",
      "Clear offcuts with the saw off, not with your fingers beside a spinning blade.",
    ],
  },
  {
    id: "grinders",
    title: "Grinders and cut-off saws",
    category: "Tools",
    points: [
      "The wheel's rated RPM must be at or above the tool's RPM. Check it.",
      "Guard on, positioned between the wheel and your face.",
      "Face shield over safety glasses. Wheels come apart.",
      "Let it spin up free for a few seconds before it touches work.",
      "Sparks find sawdust, insulation and rags. Look at what is downstream.",
    ],
  },
  {
    id: "hand-tools",
    title: "Hand tools and utility knives",
    category: "Tools",
    points: [
      "Cut away from your body and away from your holding hand.",
      "A dull blade takes more force and slips more. Change it.",
      "Retract the blade the moment the cut is done. Not when you get to the truck.",
      "Chisels, screwdrivers and pry bars each have one job. Do not substitute.",
      "Mushroomed heads and split handles get replaced.",
    ],
    source: cpwr("TT-Hammer_Safety.pdf"),
  },
  {
    id: "air-hoses",
    title: "Compressors and air hoses",
    category: "Tools",
    points: [
      "Whip checks on every coupling. A loose hose under pressure is a weapon.",
      "Route hoses out of walkways and off stair treads.",
      "Bleed the pressure before you break a connection.",
      "Never use compressed air to blow dust off skin or clothing.",
      "Drain the tank. A rusted-through tank fails all at once.",
    ],
  },
  {
    id: "tool-batteries",
    title: "Tool batteries and chargers",
    category: "Tools",
    points: [
      "A swollen, dented or dropped pack goes out of service. Do not charge it.",
      "Charge on a hard surface, not on sawdust, not in a truck bed full of rags.",
      "A pack that is hot from use goes on the charger after it cools.",
      "Do not leave packs charging in a locked van overnight on a job.",
      "Damaged lithium packs need proper disposal, not the site dumpster.",
    ],
  },

  /* ------------------------------------------------------------- electrical */
  {
    id: "gfci-cords",
    title: "GFCI and extension cords",
    category: "Electrical",
    points: [
      "Every site tool goes through a GFCI. Test it with the button.",
      "Inspect cords for nicks, exposed conductor and a missing ground pin. Cut damaged ones in half.",
      "Match the cord gauge to the run and the load. A long thin cord heats up.",
      "Do not daisy chain, do not run cords through doorways or standing water.",
      "Pull the plug, not the cord.",
    ],
    source: cpwr("TT-Extension_Cord_Safety.pdf"),
  },
  {
    id: "overhead-lines",
    title: "Overhead power lines",
    category: "Electrical",
    points: [
      "Look up before you raise a ladder, a sheet of siding or a gutter.",
      "Stay at least 10 feet from any line, and treat every line as live.",
      "Fiberglass ladders near lines. Never aluminum.",
      "A service drop to a house is still enough to kill you.",
      "If equipment contacts a line, stay in it and call the utility.",
    ],
    source: cpwr("TT-Overhead_Power_Lines.pdf"),
  },
  {
    id: "temp-power",
    title: "Temporary power and panels",
    category: "Electrical",
    points: [
      "Verify dead with a meter before you touch it. Every time, even if you turned it off.",
      "Lock and tag the breaker. A homeowner flipping it back on is a real event.",
      "Cover open panels and boxes at the end of the day.",
      "Do not work on live gear because the schedule is tight.",
      "Wet hands, wet ground and electricity do not mix.",
    ],
    source: cpwr("TT-Lockout_Tagout.pdf"),
  },
  {
    id: "occupied-home-electrical",
    title: "Electrical work in an occupied home",
    category: "Electrical",
    points: [
      "The panel labels are often wrong. Verify the circuit yourself.",
      "Tell the homeowner what is going off and for how long.",
      "Tape the breaker so nobody restores power to be helpful.",
      "Watch for old wiring: knob and tube, aluminum branch circuits, no ground.",
      "Anything you open, you close before you leave.",
    ],
    source: cpwr("TT-Electrical_Wiring.pdf"),
  },
  {
    id: "buried-utilities",
    title: "Call 811 before you dig",
    category: "Electrical",
    points: [
      "Locate request goes in before any dig — footings, posts, drainage, a fence.",
      "Private lines are NOT marked by 811. Well lines, propane, septic, the shop feed.",
      "Hand-dig inside the tolerance zone either side of a mark.",
      "Marks fade. If they are old, call again.",
      "Ask the homeowner what they know is buried. They usually know something.",
    ],
    source: cpwr("TT-Buried_Utilites.pdf"),
  },

  /* -------------------------------------------------------- dust & chemicals */
  {
    id: "silica",
    title: "Silica dust",
    category: "Dust & chemicals",
    points: [
      "Cutting concrete, pavers, block, tile or fiber-cement siding all release silica.",
      "Water or a shroud with a HEPA vacuum. Dry cutting outdoors still exposes you.",
      "Never dry-cut inside an enclosed space.",
      "It does not irritate, so there is no warning. The damage is permanent.",
      "Score-and-snap or shears for siding beats a saw where the cut allows.",
    ],
    source: cpwr("TT-Silica.pdf"),
  },
  {
    id: "asbestos-remodel",
    title: "Asbestos in a remodel",
    category: "Dust & chemicals",
    rule: "WAC 296-62-07721 — a good faith inspection is required before renovation or demolition",
    points: [
      "In WA, a good faith survey happens BEFORE the work, not after somebody opens a wall.",
      "Suspect anything pre-1980: vinyl floor tile and the mastic, sheet flooring, joint compound, popcorn ceiling, pipe wrap, siding, roofing felt, vermiculite in the attic.",
      "You cannot tell by looking. Only a lab tells you.",
      "If you hit suspect material unexpectedly: stop, leave it, do not sweep, tell the office.",
      "Do not 'just get it out quick'. That is the exposure.",
    ],
    source: wac("296-62-07721", "WAC 296-62-07721"),
  },
  {
    id: "lead-paint",
    title: "Lead paint in pre-1978 homes",
    category: "Dust & chemicals",
    points: [
      "Assume lead in any home built before 1978 unless it has been tested.",
      "EPA RRP rules apply: certified renovator, contained work area, plastic down.",
      "No dry sanding, no open-flame burning, no power sanding without HEPA.",
      "Wash hands and face before eating. Change out of work clothes before going home.",
      "Kids and pregnant women are the reason this matters. Do not track it out.",
    ],
    source: cpwr("TT-Lead_Exposure.pdf"),
  },
  {
    id: "wood-dust",
    title: "Wood dust, MDF and cedar",
    category: "Dust & chemicals",
    points: [
      "Vacuum at the tool beats a shop vac afterward, which beats a broom.",
      "MDF and engineered products carry resins and binders, not just wood.",
      "Cedar and some hardwoods sensitize. The reaction gets worse with exposure, not better.",
      "N95 minimum for sustained cutting or sanding indoors.",
      "Open a window and add a fan. Dilution is cheap.",
    ],
  },
  {
    id: "spray-foam",
    title: "Spray foam and isocyanates",
    category: "Dust & chemicals",
    points: [
      "Know the re-entry time before the crew comes back in. It is on the product data sheet.",
      "Nobody else in the building while it is sprayed, including other trades.",
      "Isocyanate sensitization is permanent. One bad exposure can end that work for you.",
      "Skin and eyes count, not just breathing.",
      "Ventilate during and after, not just after.",
    ],
    source: cpwr("TT-Isocyanates.pdf"),
  },
  {
    id: "solvents-finishes",
    title: "Solvents, adhesives and finishes",
    category: "Dust & chemicals",
    points: [
      "Read the SDS before the first use, not after somebody feels sick.",
      "Ventilate. Cross-ventilation, not one cracked window.",
      "Oily and solvent rags go in a sealed metal can. Piled in a corner they ignite themselves.",
      "No open flame, no space heater, no grinder near solvent vapors.",
      "Headache and dizziness mean get out, not push through.",
    ],
    source: cpwr("TT-Solvents.pdf"),
  },
  {
    id: "crawlspace-air",
    title: "Crawlspaces, attics and mold",
    category: "Dust & chemicals",
    points: [
      "Check the air before you commit. Sewer gas, propane and stale air collect down there.",
      "N95 minimum. Coveralls if the insulation is disturbed.",
      "Wet insulation and mold get wetted down, bagged, and carried out. Never swept.",
      "Attics in summer are a heat emergency waiting to happen. Go early.",
      "Tell someone where you are and when you will be out.",
    ],
  },
  {
    id: "rodent-droppings",
    title: "Rodent droppings and hantavirus",
    category: "Dust & chemicals",
    points: [
      "Crawlspaces, attics, sheds and old outbuildings are where this lives around here.",
      "Never sweep or vacuum dry droppings. That is exactly how it gets airborne.",
      "Mist with a bleach solution, let it sit, then wipe up wet and bag it.",
      "Gloves and an N95 at minimum.",
      "Flu-like symptoms with shortness of breath in the weeks after: tell a doctor about the exposure.",
    ],
    source: cpwr("TT-Biohazard_Safety.pdf"),
  },
  {
    id: "wet-concrete",
    title: "Wet concrete burns",
    category: "Dust & chemicals",
    points: [
      "Wet concrete is caustic. It burns slowly and you may not feel it until it is deep.",
      "Boots and gloves that concrete cannot get inside. Tape the gap.",
      "Kneeling in it is the classic injury. Use a board.",
      "Wash it off with clean water immediately, do not wait for the pour to finish.",
      "Rinse eyes for 15 minutes and go in. Do not tough it out.",
    ],
    source: cpwr("TT-Wet_Concrete.pdf"),
  },

  /* ------------------------------------------------------------ body & lifting */
  {
    id: "lifting-sheet-goods",
    title: "Lifting drywall and sheet goods",
    category: "Body & lifting",
    points: [
      "Two people or a cart. A sheet of 5/8 is 70-plus pounds and it is all leverage.",
      "Plan the path before you pick it up. Know where you will set it down.",
      "Keep the load between waist and shoulder. Feet move, spine does not twist.",
      "Use a panel lift for ceilings. It is faster anyway.",
      "The last sheet of the day is the one that hurts you. Ask for a hand.",
    ],
    source: cpwr("TT-Materials_Handling_Drywall.pdf"),
  },
  {
    id: "carrying-windows",
    title: "Carrying windows, doors and slabs",
    category: "Body & lifting",
    points: [
      "Walk the route first. Steps, thresholds, cords, a dog.",
      "Agree who calls the moves before you lift.",
      "Carry glass on edge, gloved, with hands clear of the pinch at the set-down.",
      "Set it on blocking, never straight on concrete or against a wall unsecured.",
      "If it needs three people, get three people.",
    ],
    source: cpwr("TT-Lifting_Carrying_Materials.pdf"),
  },
  {
    id: "awkward-postures",
    title: "Kneeling, crouching and overhead work",
    category: "Body & lifting",
    points: [
      "Kneepads for flooring, tile and base. Knees do not grow back.",
      "Overhead work with arms up cooks the shoulders. Rotate people through it.",
      "Raise the work instead of bending to it. A bench, a horse, a taller pile.",
      "Change task every 30 minutes if you can. Variety is the control.",
      "Numbness or tingling is a signal, not a normal part of the job.",
    ],
    source: cpwr("TT-Carpal_Tunnel_Syndrome.pdf"),
  },
  {
    id: "vibration",
    title: "Hand-arm vibration",
    category: "Body & lifting",
    points: [
      "Hammer drills, grinders, impacts and sanders all add up over a day.",
      "Grip lightly. A tight grip pushes more vibration into the hand.",
      "Break the exposure up. Swap tasks rather than running the tool all morning.",
      "Keep hands warm. Cold makes the damage worse.",
      "White, numb fingers after work are an early warning. Say something.",
    ],
    source: cpwr("TT-Vibration_Hand_Arm.pdf"),
  },
  {
    id: "stretch-and-flex",
    title: "Stretch and flex before the first lift",
    category: "Body & lifting",
    seasons: ["winter", "fall"],
    points: [
      "Five minutes at the truck. Back, shoulders, hamstrings, wrists.",
      "Cold muscles tear. On a 38-degree morning that is most of the crew.",
      "The first hour has the most strains of any hour of the day.",
      "It also gets everyone talking before work starts, which is half the point.",
      "Nobody has to be good at it.",
    ],
  },

  /* -------------------------------------------------------------------- PPE */
  {
    id: "eye-protection",
    title: "Eye protection",
    category: "PPE",
    points: [
      "Nail ricochet, grinding sparks, insulation, sawdust overhead, hot chips off a drill.",
      "Wear them for the short cut too. Every eye injury was a job that took a second.",
      "Over-prescription glasses or prescription safety glasses. Regular glasses are not PPE.",
      "Scratched lenses make people take them off. Replace them.",
      "Do not rub. Flush and go in.",
    ],
    source: cpwr("TT-Eye_Protection.pdf"),
  },
  {
    id: "hearing",
    title: "Hearing protection",
    category: "PPE",
    points: [
      "A circular saw, a router and a framing nailer are each loud enough to damage hearing.",
      "If you have to shout at arm's length, you need protection.",
      "Plugs, muffs, or both for the loudest work. Plugs must go in properly to do anything.",
      "Hearing loss is gradual, painless, and permanent. There is no repair.",
      "Ringing after a workday means damage happened that day.",
    ],
    source: cpwr("TT-Noise_Hearing_Protection.pdf"),
  },
  {
    id: "hard-hats",
    title: "When the hard hat goes on",
    category: "PPE",
    points: [
      "Any time there is work overhead, a crane or boom truck, or a delivery being set.",
      "Framing, roofing, and anything with a second story above you.",
      "The suspension does the work. Adjust it and do not wear it backward unless it is rated for that.",
      "Replace after any impact, and check the shell for chalking and cracks.",
      "Nothing between the shell and the suspension. Not a cap, not a rag.",
    ],
    source: cpwr("TT-Head_Protection.pdf"),
  },
  {
    id: "gloves",
    title: "The right glove for the task",
    category: "PPE",
    points: [
      "Cut-resistant for knives, sheet metal and glass. Leather for framing and handling.",
      "Chemical gloves for solvents and concrete. Leather soaks it in and holds it against you.",
      "NO gloves near a rotating tool — drill press, table saw, lathe. They pull your hand in.",
      "Wet gloves in cold weather are worse than none.",
      "Check for holes before trusting them with something sharp.",
    ],
  },
  {
    id: "respirators",
    title: "Respirators and fit",
    category: "PPE",
    points: [
      "N95 for nuisance dust. Half-face with the right cartridge for silica, lead, and vapors.",
      "A beard breaks the seal. There is no way around that with a tight-fitting mask.",
      "Do a seal check every time you put it on.",
      "Cartridges expire and load up. Know when to change them.",
      "A dust mask does nothing against solvent vapor. Different hazard, different filter.",
    ],
    source: cpwr("TT-Respiratory_Protection.pdf"),
  },

  /* ---------------------------------------------------------------- weather */
  {
    id: "heat",
    title: "Heat exposure",
    category: "Weather",
    seasons: ["summer"],
    rule: "WAC 296-62-095 — applies year-round; action level 80°F, mandatory paid cool-down at 90°F",
    points: [
      "In WA the rule runs year-round now, not just summer. Action level is 80°F outdoors.",
      "At 90°F everyone gets a paid 10-minute cool-down every two hours. That is required, not optional.",
      "Water available and encouraged. Shade available. Acclimatize new and returning people.",
      "Attics, crawlspaces and unvented second floors run far hotter than the forecast.",
      "Confusion, no sweating, or stumbling is heat stroke. Call 911 and start cooling immediately.",
    ],
    source: wac("296-62-095", "WAC 296-62-095"),
  },
  {
    id: "wildfire-smoke",
    title: "Wildfire smoke",
    category: "Weather",
    seasons: ["summer", "fall"],
    rule: "Chapter 296-820 WAC — wildfire smoke, effective January 2024",
    points: [
      "Check the AQI in the morning and again after lunch. It moves fast.",
      "Around AQI 70 and up: awareness, and N95s offered at no cost to anyone who wants one.",
      "As it climbs, move work indoors, reschedule the dusty and heavy tasks, or send people home.",
      "Smoke plus heat is worse than either. Both rules apply at once.",
      "Anyone with asthma tells the lead. Do not make them raise it in front of the crew.",
    ],
    source: {
      label: "Chapter 296-820 WAC",
      url: "https://lni.wa.gov/safety-health/safety-rules/chapter-pdfs/WAC296-820.pdf",
    },
  },
  {
    id: "cold-wet",
    title: "Cold and wet weather",
    category: "Weather",
    seasons: ["fall", "winter"],
    points: [
      "Layers beat one heavy coat. Wet cotton against skin is the problem.",
      "Keep a dry spare pair of gloves in the truck. Wet gloves stop working.",
      "Warm-up breaks somewhere actually warm, not just out of the wind.",
      "Shivering that stops, slurred speech, or clumsy hands: get them warm and get help.",
      "Cold hands drop tools and miss grips. It shows up as a different injury.",
    ],
    source: cpwr("TT-Cold_Weather.pdf"),
  },
  {
    id: "wind",
    title: "Working in wind",
    category: "Weather",
    seasons: ["fall", "winter", "spring"],
    points: [
      "A sheet of plywood or siding is a sail. Two hands, or wait.",
      "Call the roof off. A gust while you are on a pitch is not survivable at the edge.",
      "Secure loose material, tarps, and anything stacked before you leave for the day.",
      "Look up at the trees. Widowmakers come down in wind, especially around here.",
      "Ladders and scaffold towers go down when the wind comes up.",
    ],
  },
  {
    id: "slick-surfaces",
    title: "Mud, rain and slick surfaces",
    category: "Weather",
    seasons: ["fall", "winter", "spring"],
    points: [
      "Wet plywood, wet OSB, wet steel and wet Tyvek are all slicker than they look.",
      "Gravel the path in and out before it becomes a mud slide.",
      "Check boot tread. Worn soles are the difference.",
      "Walk it, do not carry through it, on the first pass.",
      "Mud on boots then onto a ladder rung is how it usually happens.",
    ],
    source: cpwr("TT-Walking_Working_Surfaces.pdf"),
  },
  {
    id: "short-days",
    title: "Dark mornings and short days",
    category: "Weather",
    seasons: ["fall", "winter"],
    points: [
      "Set up task lighting before you need it, not once it is already dark.",
      "High-vis when there is any vehicle movement, and on the road edge.",
      "Trip hazards you walked around all summer become invisible at 4:30.",
      "Do not start the last cut of the day in bad light. It can wait.",
      "Headlamps in every truck.",
    ],
  },

  /* ------------------------------------------------------ site & housekeeping */
  {
    id: "housekeeping",
    title: "Housekeeping and trip hazards",
    category: "Site & housekeeping",
    points: [
      "Clean as you go. The end-of-day sweep is a backstop, not the plan.",
      "Cords and hoses off walkways and stairs.",
      "Offcuts and banding get picked up now. Banding is a trip wire.",
      "Keep a clear path to the exits and to the panel.",
      "A clean site is a faster site. This one pays for itself.",
    ],
    source: cpwr("TT-Housekeeping.pdf"),
  },
  {
    id: "nails-and-punctures",
    title: "Nails, screws and puncture wounds",
    category: "Site & housekeeping",
    points: [
      "Bend it or pull it the moment you see it. Never leave a nail pointing up.",
      "Demo lumber gets stacked with the nails down or pulled.",
      "Puncture wounds close over and get infected. They are not minor.",
      "Know when your tetanus shot was. Ten years is the interval.",
      "Report it even if it seems like nothing.",
    ],
  },
  {
    id: "debris-dumpsters",
    title: "Debris, dumpsters and demo waste",
    category: "Site & housekeeping",
    points: [
      "Do not climb into a dumpster to stomp it down.",
      "Load heavy low, watch the swing when you throw over the edge.",
      "Demo debris hides nails, glass and blades. Gloves, always.",
      "Do not overfill past the rail. It comes off on the road.",
      "Anything suspect for asbestos or lead does not go in the box.",
    ],
  },
  {
    id: "temp-stairs",
    title: "Stairs and access during construction",
    category: "Site & housekeeping",
    points: [
      "Temporary treads get fastened. Not stacked, not laid loose.",
      "A handrail goes on as soon as there are four risers.",
      "Keep the stairs clear. They are not a shelf for material.",
      "One work light on the stair, always.",
      "Landings with an open side get a guardrail before anyone uses them.",
    ],
  },
  {
    id: "small-excavations",
    title: "Footings, trenches and small excavations",
    category: "Site & housekeeping",
    points: [
      "Four feet deep is where the rules bite. A footing trench counts.",
      "Spoil pile at least two feet back from the edge.",
      "Water in the trench changes everything. Re-check it after rain.",
      "Ladder or ramp within 25 feet of anyone working down there.",
      "A cubic yard of soil weighs about as much as a car. It does not need to be deep to kill.",
    ],
    source: cpwr("TT-Trench_Safety.pdf"),
  },
  {
    id: "public-and-kids",
    title: "Neighbors, kids and site security",
    category: "Site & housekeeping",
    points: [
      "Ladders down and laid flat at the end of the day.",
      "Lock the tools, close the openings, cover the holes.",
      "Kids find a site interesting. Assume they will come look.",
      "Keep the public out of the work area, including a curious homeowner.",
      "Park so you are not blocking a neighbor or a driveway.",
    ],
  },

  /* --------------------------------------------------------- driving & loads */
  {
    id: "trailer-towing",
    title: "Towing a trailer",
    category: "Driving & loads",
    points: [
      "Coupler latched and pinned, chains crossed under the tongue, breakaway cable connected.",
      "Check lights before you pull out. Every time.",
      "Tongue weight roughly 10-15% of the load. Too little and it sways.",
      "Test the brakes in the first hundred feet.",
      "Back with a spotter, or get out and look. There is no rush.",
    ],
  },
  {
    id: "load-securement",
    title: "Securing a load",
    category: "Driving & loads",
    points: [
      "Straps, not rope. Rated straps in good condition, and check them mid-trip.",
      "Flag anything past the tailgate.",
      "Long lumber flexes and walks. Tie the front and the back.",
      "Loose tools and buckets become projectiles in a hard stop.",
      "Ladder racks: check the tie-downs after every stop.",
    ],
  },
  {
    id: "ferry-deck",
    title: "Ferry loading and vehicle decks",
    category: "Driving & loads",
    points: [
      "Set the brake, put it in gear or park, and turn the engine off.",
      "Follow the crew's directions, not the car in front.",
      "Check the load before you drive on. The deck is where a shifted load gets noticed.",
      "Watch the ramp lip when towing. Long trailers drag.",
      "Do not sit in the vehicle on a lower deck if the crew tells you to go up.",
    ],
  },
  {
    id: "backing-blind-spots",
    title: "Backing and blind spots",
    category: "Driving & loads",
    points: [
      "Walk around the vehicle before you get in. Every time.",
      "Use a spotter on a tight site, and agree the signals first.",
      "Back into the parking spot when you arrive, so you drive out forward.",
      "Most site vehicle incidents happen in reverse at under 5 mph.",
      "Mirrors do not show a person crouched behind the bumper.",
    ],
    source: cpwr("TT-Work_Zone_Safety_Working_Around_Vehicles.pdf"),
  },
  {
    id: "driving-distraction",
    title: "Driving, distraction and fatigue",
    category: "Driving & loads",
    points: [
      "The phone goes down. The text can wait for the ferry line.",
      "The drive home after a long day is the highest-risk part of the day.",
      "Deer at dusk on the island roads. Slow down.",
      "Rushing for a boat is how people get hurt. Take the next one.",
      "Nobody is expected to drive tired to make a schedule.",
    ],
    source: cpwr("TT-Traffic_Safety.pdf"),
  },

  /* ------------------------------------------------------ health & wellbeing */
  {
    id: "mental-health",
    title: "Mental health and suicide prevention",
    category: "Health & wellbeing",
    points: [
      "Construction has one of the highest suicide rates of any industry. This is a jobsite hazard.",
      "Warning signs: withdrawal, anger, showing up wrecked, giving things away, talking about being a burden.",
      "Ask directly. Asking does not plant the idea. It is the thing that helps.",
      "988 is the Suicide and Crisis Lifeline. Call or text, 24 hours.",
      "Nobody here loses their job for saying they are struggling.",
    ],
    source: cpwr("TT-Suicide_Prevention.pdf"),
  },
  {
    id: "opioids",
    title: "Pain, opioids and getting back to work",
    category: "Health & wellbeing",
    points: [
      "An injury on this job should not turn into a dependency. That path is common in this trade.",
      "Tell the doctor you do physical work and ask what the alternatives are.",
      "Do not take someone else's prescription, and do not share yours.",
      "Never work on something that makes you drowsy. Tell the lead instead.",
      "Naloxone works and is available without a prescription in WA.",
    ],
    source: cpwr("TT-Opioids.pdf"),
  },
  {
    id: "fatigue",
    title: "Fatigue and long hours",
    category: "Health & wellbeing",
    points: [
      "Error rates climb sharply after about the tenth hour.",
      "Being awake 18 hours impairs you about like being legally drunk.",
      "Say so if you are running on no sleep. We will change the task, not the person.",
      "Watch each other in the last hour. That is when the cuts happen.",
      "Early start plus a ferry plus a full day is a long day. Count the whole thing.",
    ],
    source: cpwr("TT-Shift_Work.pdf"),
  },
  {
    id: "hydration",
    title: "Water, food and getting through the day",
    category: "Health & wellbeing",
    points: [
      "Coffee and energy drinks are not hydration.",
      "Drink before you are thirsty. Thirst is already behind.",
      "Take the lunch. Skipping it shows up as a mistake at 2:30.",
      "Dark urine means you are already low.",
      "In the heat, aim for a cup of water every 15-20 minutes.",
    ],
  },
  {
    id: "sun-skin",
    title: "Sun and skin cancer",
    category: "Health & wellbeing",
    seasons: ["spring", "summer"],
    points: [
      "Outdoor workers get far more lifetime UV than anyone else. Overcast does not stop it.",
      "Sunscreen on ears, neck, nose and the backs of hands. Reapply after lunch.",
      "Long sleeves in a light fabric beat sunscreen and are cooler than you think.",
      "A wide brim or a hard hat brim attachment.",
      "Get a mole checked if it changes. Skin cancer caught early is nothing.",
    ],
    source: cpwr("TT-Skin_Cancer.pdf"),
  },

  /* ------------------------------------------------- planning & emergencies */
  {
    id: "pre-task-planning",
    title: "Five-minute pre-task plan",
    category: "Planning & emergencies",
    points: [
      "Before a new task: what are we doing, what could hurt someone, what are we doing about it.",
      "Name who is exposed, including other trades and the homeowner.",
      "Decide the tools and PPE now, so nobody improvises at height.",
      "Say the stop condition out loud. Wind, dark, rain, missing gear.",
      "The plan changes when the job changes. Redo it.",
    ],
  },
  {
    id: "near-miss",
    title: "Near-miss reporting",
    category: "Planning & emergencies",
    points: [
      "A near miss is the injury you got for free. Use it.",
      "No blame. We want the story, not a name.",
      "Tell the lead the same day, while you still remember the detail.",
      "The same near miss happening twice means we did not fix it.",
      "Say it even if it makes you look careless. Especially then.",
    ],
  },
  {
    id: "first-aid",
    title: "First aid and bleeding control",
    category: "Planning & emergencies",
    points: [
      "Everyone knows where the kit is on this site. Point at it now.",
      "Who here is current on first aid and CPR?",
      "Serious bleeding: direct pressure, hard, and do not keep lifting to look.",
      "Restock what you use. An empty kit is worse than no kit.",
      "Eye wash and clean water available where we cut and mix.",
    ],
  },
  {
    id: "island-emergency",
    title: "Emergency plan on an island site",
    category: "Planning & emergencies",
    points: [
      "What is this site's address? Say it out loud now, before you need it.",
      "Gate codes, driveway length, and where the ambulance actually parks.",
      "Who calls 911, and who walks to the road to flag them in.",
      "Serious trauma here can mean an air lift. That changes the timeline, so the first aid matters more.",
      "Cell coverage is not uniform. Know the spot on this site that works.",
    ],
  },
  {
    id: "new-worker",
    title: "New and young workers",
    category: "Planning & emergencies",
    points: [
      "The first 90 days on a job carry the highest injury rate, whatever the person's experience.",
      "Everyone new gets a buddy for the first weeks. Name them.",
      "New people will not ask twice. Check on them instead of waiting.",
      "Tell them explicitly: refusing unsafe work is fine here.",
      "Show them the kit, the exits, the panel, and the address.",
    ],
  },
  {
    id: "working-alone",
    title: "Working alone",
    category: "Planning & emergencies",
    points: [
      "Tell someone where you are going and when you will be done.",
      "Check in when you finish. Somebody notices if you do not.",
      "No ladder work, roof work or crawlspace work alone.",
      "Keep the phone on you, not in the truck.",
      "If you fall and nobody knows where you are, the injury is not the problem.",
    ],
  },
  {
    id: "sub-coordination",
    title: "Working around other trades",
    category: "Planning & emergencies",
    points: [
      "Walk the site with the sub at the start of the day. Know who is overhead.",
      "Their hazard is your hazard. A hole they opened still swallows you.",
      "Do not use another trade's ladder or scaffold without asking and checking it.",
      "Tell them what we are doing that affects them: power off, roof loaded, dust.",
      "Anybody on this site can stop work. Subs included.",
    ],
  },
  {
    id: "fire-hot-work",
    title: "Fire, heaters and hot work",
    category: "Planning & emergencies",
    points: [
      "Extinguisher within reach before any torch, grinder or heater runs.",
      "Clear sawdust, insulation and rags for 35 feet, or shield them.",
      "Watch the area for 30 minutes after hot work stops. Smoldering is slow.",
      "Temporary heaters need clearance and a level base. Not against plastic.",
      "Know where the water is and how the fire department gets in.",
    ],
    source: cpwr("TT-Fire_Safety.pdf"),
  },
  {
    id: "carbon-monoxide",
    title: "Carbon monoxide",
    category: "Planning & emergencies",
    seasons: ["fall", "winter"],
    points: [
      "Generators, propane heaters, concrete saws and pressure washers all make CO.",
      "Never run any of them inside, in a garage, or in a crawlspace. An open door is not ventilation.",
      "You cannot smell it or see it. Headache, nausea and confusion are the only warning.",
      "Winter is the season, because everyone closes the building up and adds heat.",
      "If more than one person has a headache in the same space, get everyone out.",
    ],
    source: cpwr("TT-Carbon_Monoxide_Poisoning.pdf"),
  },
  {
    id: "occupied-remodel",
    title: "Occupied remodels, homeowners and dogs",
    category: "Planning & emergencies",
    points: [
      "Confirm where the pets are before the first door opens. A loose dog stops the day.",
      "Kids and elderly clients move through the site quietly. Assume they are there.",
      "Dust barriers up before demo, and a walking path that is not the work area.",
      "Never leave a tool, a blade or an open hole where the family lives.",
      "Tell the homeowner what will be loud, dusty, or off, and when.",
    ],
  },
];

/* ------------------------------------------------------------- lookups */

const BY_TITLE = new Map(SAFETY_TOPICS.map((t) => [t.title.toLowerCase(), t]));

/**
 * The catalog entry for a typed topic string, if it is one of ours.
 *
 * The topic field stays free text — the crew can hold a meeting about anything.
 * This just re-attaches the talking points when the text matches a catalog
 * title, so picking a topic and typing its exact name behave the same.
 */
export function findSafetyTopic(title: string): SafetyTopic | undefined {
  return BY_TITLE.get(title.trim().toLowerCase());
}

/** The season a date falls in, local calendar quarters shifted to the weather. */
export function seasonOf(d: Date = new Date()): SafetySeason {
  const m = d.getMonth(); // 0-11
  if (m <= 1 || m === 11) return "winter";
  if (m <= 4) return "spring";
  if (m <= 7) return "summer";
  return "fall";
}

/** Topics tagged for this season. Untagged topics are not "in season" — they are always fine. */
export function topicsInSeason(season: SafetySeason): SafetyTopic[] {
  return SAFETY_TOPICS.filter((t) => t.seasons?.includes(season));
}

/**
 * Free-text search over title, category and points.
 *
 * Every term must match somewhere, so "wet ladder" narrows rather than widens.
 */
export function searchSafetyTopics(query: string): SafetyTopic[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return SAFETY_TOPICS;
  return SAFETY_TOPICS.filter((t) => {
    const hay = `${t.title} ${t.category} ${t.points.join(" ")}`.toLowerCase();
    return terms.every((term) => hay.includes(term));
  });
}
