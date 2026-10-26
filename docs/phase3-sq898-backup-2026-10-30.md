# SQ898 backup future-flight candidate: 30 October 2026

**Selection:** SQ898, Singapore Changi (SIN) to Hong Kong (HKG), scheduled departure 30 October 2026 18:55 SGT (10:55 UTC), scheduled arrival 30 October 22:45 HKT (14:45 UTC). Singapore and Hong Kong are both UTC+8. Operating airline is Singapore Airlines. No marketing codeshare appears in the captured HKIA row; recheck before registration.

**Independent official plan evidence:** The [Singapore Airlines timetable](https://www.singaporeair.com/en_UK/vn/flying-withus/cabins/business-class/business-class-4/) lists SQ898, SIN–HKG, 18:55–22:45, daily from 25 October 2026 through 27 March 2027. The [HKIA arrivals page](https://www.hongkongairport.com/en/flights/arrivals/passenger.page) and its future-flight endpoint returned a 30 October passenger-arrival row for SQ898, SIN, 22:45, `status: null`. That null is a future status, **not** an on-time result.

Raw files kept outside the repository in `courses/COMP7610/evidence/`:

- `phase3-sq898-sia-timetable-2026-10-26.html`, fetched 26 October 10:41:28 UTC, SHA-256 `32b6ede16c821fc55a7384bbf30024a500140779d9164bafd25c572417e5b9d9`.
- `phase3-sq898-hkia-live-2026-10-30.json`, fetched 26 October 15:55:50 UTC, SHA-256 `ac66f6d3f4e55febae8bcc57f8d5c0c7842d75f2f53407aac5b27896a4e010d5`. Source URL: `https://www.hongkongairport.com/flightinfo-rest/rest/flights?date=2026-10-30&arrival=true&cargo=false&lang=en`.

The exact normalized [plan input](evidence/sq898-plan-input-2026-10-30.txt) has SHA-256 `0xc23e0ad8a85cbaa5df617537a1328f092799382027cdb766753025ff135e133b`. Proposed UTC departure is `1793357700`, arrival `1793371500`. Last allowed purchase is **29 October 18:55 SGT/HKT**, inclusive. Verification opens **31 October 00:00 HKT**. Seven-day unresolved refund becomes eligible **6 November 22:45 HKT**.

**Admission state:** Backup evidence assembled, not registered and not on sale. Recheck both official records, aliases, actual chain time, approved terms and budget immediately before any registration or purchase. The backup has a later cutoff than the primary 29 October flight and leaves a real-result buffer before the 8 November coursework deadline. Do not fill in a result manually if HKIA history is absent or unclear.
