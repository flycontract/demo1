# Teaching flight delay cover: terms v1 (26 October 2026)

The project owner delegated drafting of **teaching-demo terms**, then explicitly accepted the metric and settlement summary on 26 October 2026. This document records that rule for the Sepolia prototype; it is not a real insurance policy. FDT has no cash value. Real flight sales remain disabled until deployment and flight-specific evidence checks are complete.

## Fixed cover

- One wallet can buy one policy for one registered physical flight, including all declared codeshare numbers. Premium: **10 FDT**. Payout: **100 FDT**. FDT has zero decimals.
- Sale is allowed while the chain timestamp is **at or before** scheduled departure minus 24 hours. The insurer must freeze scheduled departure and arrival as UTC instants, the operating flight, codeshares, origin and local departure date, official source URL, retrieval time and evidence hash **before the first sale**. Later timetable changes do not rewrite sold cover.
- Only a final Hong Kong International Airport passenger-arrival record for the same flight and origin can decide the result. A final `At gate` time at least **7,200 seconds after** frozen scheduled arrival pays 100 FDT. An explicit final `Cancelled` also pays 100 FDT. Earlier arrival or a smaller delay closes the policy with no payout. `At gate` is the airport's published status metric, **not a separately verified touchdown or runway time**.
- The airport's historical `time` field is **not** treated as the original scheduled plan; its published definition does not prove that meaning. Estimated, missing, ambiguous, malformed, pending-cancellation or inaccessible data are unknown, not no-delay results. The single trusted oracle records the original response and parser version before reporting a final result.
- Verification may start after the scheduled Hong Kong arrival calendar day ends. A first final result must reach the contract strictly before scheduled arrival plus seven days. If none has reached it by that instant, a holder can recover the 10 FDT premium. A final result accepted earlier still governs remaining policies after the deadline.
- The insurer seeds 10,000 FDT and reserves 100 FDT per open policy. Pool balance below 8,000 FDT closes new sales but does not cancel existing obligations. Chain and oracle failures can delay settlement; a source correction after a final on-chain result is not automatically reversible.

## Flight admission gate

For each real flight, retain **independent, official, dated, per-flight evidence** of both planned departure and planned arrival, route and codeshares. Check that the official future-flight record and the frozen on-chain registration describe the same aircraft movement. If evidence is missing, conflicts, or the sale deadline has passed, do not mark the flight sellable. Test simulations and booking-site screenshots may illustrate the flow but cannot replace this gate.

## MU725 candidate, 27–28 October 2026

The user supplied a booking-site screenshot showing MU725, PVG T1 departure on 27 October at 21:15 China time, and HKG T1 arrival on 28 October at 00:15 Hong Kong time. An HKIA official live-arrivals response independently lists **MU 725 / FM 3029**, origin PVG, planned arrival **28 October 00:15 HKT**. The screenshot alone does **not** establish an official planned departure. The candidate's illustrative sale cutoff is **26 October 21:15 CST/HKT**; it must not be listed for sale unless the official departure evidence and all deployment checks are finished before then.
