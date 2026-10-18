# Logistic regression Model 1 and pure-Python QNX runtime

Date: 2026-10-18 UTC. Status: user-approved specification change, prepared on a
branch for review (not pushed by this task).

## Approval and reason

Chloe, the Model 1 and edge-inference owner, compared the models that Veri trained
and confirmed the choice: “logistic regression”. She then approved preparing the
matching specification, ADR and README edits on a branch for review.

The deployed Model 1 is a **logistic regression** on 424 portable CSI motion
features. It is not the Random Forest recorded in ADR-036. This change also replaces
the assumed `python3-tflite-runtime` inference path with the runtime that actually
executes the model on QNX.

**Evidence** (all in the `blissey-model` repository):

- **Veri job `baae987abfc5`** ran the pinned pipeline (`pipeline_v3`) on the AP-side
  recording session `AP_data` (`chloe526/blissey-data@cbff5ec`, one participant,
  10 staged falls).
- It trained and cross-validated logistic regression, random forest and
  gradient-boosted trees on the same portable features. It reported a 575-feature
  random forest as a numpy-only reference.
- The selection rule was declared before the run: most falls detected, then fewest
  false alerts per hour, then simplest. Within-session cross-validation results:

  | Model | Falls detected | False alerts/h |
  | --- | --- | --- |
  | Logistic regression (selected) | 10/10 | 68 |
  | Random forest | 9/10 | 61 |
  | Gradient-boosted trees | 8/10 | 126 |

  These numbers are **optimistic**: same room, setup and time block, and no held-out
  session.
- **Runtime:** the model ships as `model.json`, executed by `blissey_edge`, which
  uses only the Python standard library (no numpy, scikit-learn, TFLite, ONNX or
  pickle). The training pipeline computes features with the same code.
- **Parity:** the export reproduced scikit-learn on all 2,310 windows (max difference
  under 1e-14). Streaming raw packets reproduced the offline scores and alerts.
- **On the actual Pi** (QNX 8.0, Python 3.14), the golden-output self-test passed at
  about 31 ms per 3-second window.

This approval does not establish a held-out accuracy figure. It also does not
establish live USB CSI capture on the Pi, a hosted end-to-end incident from the Pi,
or sponsor eligibility.

## Previous and revised requirements

| Affected PROJECT_SPEC sections | Previous | Revised |
| --- | --- | --- |
| 1, 4, 6 | Random Forest trained using Veri; `python3-tflite-runtime` as the QNX inference runtime | Logistic regression selected from Veri-trained candidates; pure-Python `blissey_edge` runtime on QNX. The TFLite integration is retained as a team record but not used by Model 1. |
| 8–9 | Selected Random Forest; forest artifact boundaries | Selected logistic regression; portable feature set, coefficients/standardization and the score adapter recorded in `model.json` |
| 12–13 | Unspecified Veri job; forest artifact bundle | Veri job `baae987abfc5` and its bundle, checksums, golden fixtures and parity checks; still no held-out result |
| 14 | Forest export/runtime unverified; do not assume TFLite | Stdlib-only runtime verified by golden replay on the Pi. Live USB CSI capture and devc-serusb startup remain validation gates. |
| 21–22, 27–30 | Random Forest ownership, sponsor, risk, priority and open-decision wording | Model-neutral or logistic-regression wording; the same evidence gates |
| 31 | ADR-036 selects the Random Forest; ADR-037 records the TFLite runtime | ADR-038 supersedes ADR-036's model selection and ADR-037's runtime assumption. Historical entries are preserved. |

## Preserved contracts

- ESP32 AP receiver → USB serial → Pi/QNX → authenticated WSS (`edge/qnx`
  transport) is unchanged, and raw CSI stays local.
- The seven-field v2 event, the `{fall, non_fall}` score pair (fall = model score,
  uncalibrated), temporal grouping (one event per episode, 60-second refractory
  period), the outbox, health messages, authentication and the incident lifecycle
  are all unchanged.
- Group-aware evaluation, training-only fitted transforms and honest held-out
  reporting are still required. A frozen held-out session remains outstanding.
