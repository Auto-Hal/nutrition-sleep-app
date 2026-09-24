# Phase 6.5 Yahoo! Shopping implementation-time terms gate

Status: VERIFIED FOR NON-COMMERCIAL MVP IMPLEMENTATION  
Checked: 2026-09-24

## Official sources checked

- Item Search v3: https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html
- Yahoo! Shopping API overview / rate guidance: https://developer.yahoo.co.jp/webapi/shopping/
- Yahoo! Developer Network guideline: https://developer.yahoo.co.jp/guideline/
- Attribution requirement: https://developer.yahoo.co.jp/attribution/
- Commercial-use help: https://support.yahoo-net.jp/PccDeveloper/s/article/H000011080

## Binding implementation constraints

- Use the fixed Item Search v3 endpoint.
- Send the registered Client ID as `appid`.
- Search with `jan_code`; never treat the request parameter itself as proof of identity.
- Re-normalize every returned `hits[].janCode` and require exact equality with the requested GTIN/JAN.
- Yahoo is identity-only. Do not derive nutrition or serving basis from description/headline/listing text.
- Do not persist raw responses, seller data, price, review, ranking, point, delivery, or image fields.
- Keep the Client ID server-only.
- Use bounded requests only; no provider retry loop. Shopping documentation warns against short-interval repeated requests (1 query/sec guidance).
- If the exact returned JAN does not converge to one identity, require user selection or fall back to manual/OCR.
- Use the official Yahoo! Developer Network attribution snippet without styling changes and place it at the lower part of the application.
- The general Web Service policy is for the user's own convenience / non-commercial use by default. Commercial use requires separate consultation.
- Public documentation reviewed here does not provide a sufficiently explicit general storage/cache grant. Therefore the MVP stores no Yahoo response object and retains only the minimal identity/provenance fields selected and confirmed by the user under the app's existing Product contract.

## Stored allowlist after user confirmation

- exact JAN/GTIN
- product name
- Yahoo brand name when present
- provider = `yahoo_shopping`
- provider item URL
- observed timestamp

Not stored:
- seller/store fields
- price
- reviews
- rankings
- points
- delivery metadata
- images
- free-text description/headline
- raw provider response

## Correctness gate

False automatic identity matches must remain zero in the acceptance set.
