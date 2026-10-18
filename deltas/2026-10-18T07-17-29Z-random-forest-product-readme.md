# Random Forest selection and product README

Date: 2026-10-18 UTC. Status: user-approved documentation reconciliation.

## Approval and reason

The user stated: “veri was used to train the randomforest classifier model for
the CSI data stream.” After reviewing the proposed product README and a review
calling for canonical model consistency, the user authorized folding in that
review, modeling the data path and rewriting the README without pushing.

During the same task, the user additionally confirmed QNX OS on Raspberry Pi 5
collects ESP32 sensing data and securely transmits results, with
`python3-tflite-runtime` from oss.qnx.com integrated to support local inference.

This authorizes recording the Random Forest/Veri selection, the supplied QNX
specifics and replacing the superseded CNN plan. It does not authorize training, model/runtime implementation,
provider calls, deployment or publication.

## Previous and revised requirements

| Affected PROJECT_SPEC sections | Previous | Revised |
| --- | --- | --- |
| 1–2, 4, 6 | Local neural network; proposed Keras 1D CNN trained in Colab | Selected Random Forest trained using Veri; Pi/QNX remains the target runtime |
| 8–9, 11–12 | CNN layers, sigmoid, Adam/BCE and epoch defaults; Keras artifacts | Actual forest configuration, saved CSI feature pipeline/class mapping, Veri job evidence and versioned forest artifacts; unknown parameters remain unknown |
| 10, 14–15 | Window tensors feed CNN; TFLite/ONNX candidate export; sigmoid-derived scores | Windows feed a frozen feature extractor and forest; record integrated QNX python3-tflite-runtime, confirm an actually compatible forest representation/path and verify class-to-score mapping and training/export/runtime parity |
| 13, 22 | Veri only as an optional separate open-source Model 2 fine-tuning investigation | Attribute actual Model 1 forest training to Veri; Gemini remains Model 2; prize eligibility is a separate unverified claim |
| 21, 24, 26–30 | Current CNN references in ownership, safety limits, checks, risks and priorities | Model-neutral or Random Forest wording, preserving the existing contracts and evaluation gates |
| 31 | ADR-002 selects CNN/Colab; exact QNX module unspecified | ADR-036 supersedes model selection; ADR-037 records team-confirmed QNX sensing/transport/runtime integration; historical rationale remains traceable |
| 32 / contributor workflow | Specification approval procedure lives in README | Preserve the procedure in CONTRIBUTING.md and link it from the product README/spec |

## Preserved contracts and evidence limits

- ESP32 receiver → direct USB serial → Pi/QNX → authenticated WSS remains the
  target path; raw CSI stays local at runtime and does not go to Gemini.
- Preserve the seven-field v2 event, named binary confidence-score interface,
  temporal grouping, authentication, persistence and incident lifecycle.
- Confirm the trained forest's real features and classes before adapting it to
  that interface; no artifact compatibility is inferred from the model name.
- Retain recording/session/participant holdouts, training-only fitted transforms,
  frozen validation decisions and honest held-out reporting.
- Training and QNX sensing/transport/runtime integration are team-confirmed. This
  task does not inspect training jobs/artifacts or hardware logs, reproduce
  evaluation, prove forest execution through TFLite or establish sponsor eligibility.
- Keep the fixture-only public dashboard distinct from the cloud pipeline and
  separately demonstrated Gemini, ElevenLabs/Photon call and Photon iMessage/ACK.
- Keep explicit notification review/consent, signed callbacks, bounded voice
  context and independent messaging authorization. No provider action is run.

The README screenshot is an intentionally tracked product-documentation asset
captured from the actual local fixture dashboard, not a model/hardware result.
