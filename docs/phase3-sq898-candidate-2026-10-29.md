# SQ898 future-flight candidate: 29 October 2026

**Selection:** SQ898, SIN → HKG, scheduled departure 29 October 2026 18:55 SGT (10:55 UTC), scheduled arrival 29 October 22:45 HKT (14:45 UTC). Singapore and Hong Kong both use UTC+8 for these dates. Candidate operator: Singapore Airlines; no marketing codeshare appeared in the captured HKIA row. The flight must be rechecked just before registration and sale.

**Independent official plan evidence:** The [Singapore Airlines timetable](https://www.singaporeair.com/en_UK/vn/flying-withus/cabins/business-class/business-class-4/) lists SQ898 under SIN → HKG, 18:55–22:45, daily from 25 October 2026 to 27 March 2027. The [HKIA passenger-arrivals service](https://www.hongkongairport.com/en/flights/arrivals/passenger.page) returned a 29 October row for `SQ898`, origin `SIN`, time `22:45`, with future status `null`. The two records agree on identity and arrival time; HKIA's future status is **not** a settled result. The original response bytes and retrieval times are recorded in [the plan input](evidence/sq898-plan-input-2026-10-29.txt). Raw source files are kept in the local course evidence directory:

- `courses/COMP7610/evidence/phase3-sq898-sia-timetable-2026-10-26.html` — SHA-256 `32b6ede16c821fc55a7384bbf30024a500140779d9164bafd25c572417e5b9d9`, fetched 26 October 10:41:28 UTC.
- `courses/COMP7610/evidence/phase3-sq898-hkia-live-2026-10-29.json` — SHA-256 `063d36246b2c511572a3090a2204e45c1106e9d5fd28f9f0630081e5cc5f2bf2`, fetched 26 October 10:41:45 UTC.

**Contract timing:** UTC departure `1793271300`, arrival `1793285100`; last allowed purchase **28 October 18:55 SGT/HKT**, inclusive. Verification opens **30 October 00:00 HKT**; unresolved refund is eligible from **5 November 22:45 HKT**. Planned times must be frozen before any sale; later timetable changes do not change sold cover.

The canonical [plan input](evidence/sq898-plan-input-2026-10-29.txt) has SHA-256 `0x1075e638cf62a9b3499f8e5cd4b07fcfb90f927ee6c32f48c01c8e38490597cd`. This is the proposed on-chain `planEvidenceHash`; it binds the exact official-source hashes, timestamps and normalized plan fields. It does not prove that either source will remain accessible or correct.

**Admission state:** Candidate evidence assembled, not registered on Sepolia and not on sale. Before a sellable registration, recheck the live official records, aliases, dates, account and contract configuration, exact terms version, and current chain time. Do not convert missing, malformed, ambiguous or pending data into a final flight result.

**27 October 00:00:49 HKT recheck:** The HKIA future-arrivals endpoint still returned one SQ898/SIN row at 22:45 for 29 October. Its status was now the empty string, whereas the earlier capture had `null`; neither is a final result. The recheck raw file is `courses/COMP7610/evidence/phase3-sq898-hkia-recheck-2026-10-27.json`, SHA-256 `eb0c39e98a649c5074d72fa0fa901d37e44b6cad2c215d4ccf4e0d28b9520b5b`, fetched 26 October 16:00:49 UTC. The original frozen plan input above remains unchanged; revalidate again immediately before on-chain admission.
