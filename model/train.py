"""
Train a lightweight BiLSTM NER model for PII detection.
Reads data from data/train.json + data/val.json produced by generate_data.py.
Exports: pii_ner.h5, data/vocab.json, data/labels.json

On Apple Silicon (M-series) install tensorflow-metal for GPU acceleration:
  pip3 install tensorflow-metal
TensorFlow will then automatically route ops to the Metal GPU backend.
"""

import json
import os
from collections import Counter
from pathlib import Path

import numpy as np

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "2"
# Force CPU-only -- Metal GPU dispatch overhead exceeds gains for this model size
os.environ["CUDA_VISIBLE_DEVICES"] = ""
os.environ["METAL_DEVICE_WRAPPER_TYPE"] = "0"
import tensorflow as tf  # noqa: E402
tf.config.set_visible_devices([], "GPU")

DATA_DIR = Path(__file__).parent / "data"
MODEL_PATH = Path("/Volumes/wintermute/docs/fhegis/pii_ner.h5")

MAX_SEQ_LEN = 128
VOCAB_SIZE = 8000
EMBED_DIM = 64
LSTM_UNITS = 64
BATCH_SIZE = 128
EPOCHS = 8

PAD_TOKEN = "<PAD>"
UNK_TOKEN = "<UNK>"


def load_data(path: Path) -> list[dict]:
    with open(path) as f:
        return json.load(f)


def build_vocab(train_data: list[dict]) -> dict[str, int]:
    counter: Counter[str] = Counter()
    for sample in train_data:
        for w in sample["words"]:
            counter[w.lower()] += 1

    # keep the top VOCAB_SIZE - 2 words (reserve 0=PAD, 1=UNK)
    most_common = counter.most_common(VOCAB_SIZE - 2)
    vocab = {PAD_TOKEN: 0, UNK_TOKEN: 1}
    for word, _ in most_common:
        vocab[word] = len(vocab)
    return vocab


def build_label_map(labels_path: Path) -> tuple[dict[str, int], list[str]]:
    with open(labels_path) as f:
        label_list: list[str] = json.load(f)
    label_to_id = {lab: i for i, lab in enumerate(label_list)}
    return label_to_id, label_list


def encode_samples(
    samples: list[dict],
    vocab: dict[str, int],
    label_to_id: dict[str, int],
) -> tuple[np.ndarray, np.ndarray]:
    X = np.zeros((len(samples), MAX_SEQ_LEN), dtype=np.int32)
    Y = np.zeros((len(samples), MAX_SEQ_LEN), dtype=np.int32)

    unk_id = vocab[UNK_TOKEN]

    for i, sample in enumerate(samples):
        words = sample["words"][:MAX_SEQ_LEN]
        labels = sample["labels"][:MAX_SEQ_LEN]
        for j, (w, lab) in enumerate(zip(words, labels)):
            X[i, j] = vocab.get(w.lower(), unk_id)
            Y[i, j] = label_to_id.get(lab, 0)

    return X, Y


def build_model(vocab_size: int, num_labels: int) -> tf.keras.Model:
    inputs = tf.keras.layers.Input(shape=(MAX_SEQ_LEN,), dtype="int32", name="word_ids")
    mask = tf.keras.layers.Lambda(lambda x: tf.not_equal(x, 0))(inputs)

    x = tf.keras.layers.Embedding(vocab_size, EMBED_DIM, mask_zero=True)(inputs)
    x = tf.keras.layers.Bidirectional(
        tf.keras.layers.LSTM(LSTM_UNITS, return_sequences=True)
    )(x, mask=mask)
    x = tf.keras.layers.TimeDistributed(
        tf.keras.layers.Dense(LSTM_UNITS, activation="relu")
    )(x)
    x = tf.keras.layers.Dropout(0.3)(x)
    outputs = tf.keras.layers.TimeDistributed(
        tf.keras.layers.Dense(num_labels, activation="softmax")
    )(x)

    model = tf.keras.Model(inputs, outputs, name="pii_ner")
    return model


def main():
    print("Training on CPU")
    print("Loading data...")
    train_data = load_data(DATA_DIR / "train.json")
    val_data = load_data(DATA_DIR / "val.json")

    print("Building vocabulary...")
    vocab = build_vocab(train_data)
    print(f"  Vocabulary size: {len(vocab)}")

    label_to_id, label_list = build_label_map(DATA_DIR / "labels.json")
    num_labels = len(label_list)
    print(f"  Label count: {num_labels}")

    # Save vocab for JS inference
    with open(DATA_DIR / "vocab.json", "w") as f:
        json.dump(vocab, f)

    print("Encoding samples...")
    X_train, Y_train = encode_samples(train_data, vocab, label_to_id)
    X_val, Y_val = encode_samples(val_data, vocab, label_to_id)

    # Compute class weights to handle heavy O-label imbalance
    label_counts = Counter(Y_train.flatten())
    total = sum(label_counts.values())
    class_weight_map = {
        cls: total / (num_labels * count) for cls, count in label_counts.items()
    }
    # Cap maximum weight to prevent instability
    max_weight = 20.0
    class_weight_map = {k: min(v, max_weight) for k, v in class_weight_map.items()}

    # Build sample weights from class weights (TimeDistributed needs sample_weight)
    sample_weights_train = np.zeros_like(Y_train, dtype=np.float32)
    for cls, w in class_weight_map.items():
        sample_weights_train[Y_train == cls] = w

    print("Building model...")
    model = build_model(len(vocab), num_labels)
    model.summary()

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
        loss="sparse_categorical_crossentropy",
        weighted_metrics=["accuracy"],
    )

    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor="val_loss", patience=2, restore_best_weights=True
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss", factor=0.5, patience=1
        ),
    ]

    print("Training...")
    model.fit(
        X_train,
        Y_train,
        sample_weight=sample_weights_train,
        validation_data=(X_val, Y_val),
        batch_size=BATCH_SIZE,
        epochs=EPOCHS,
        callbacks=callbacks,
    )

    # Evaluate
    print("\nEvaluating on validation set...")
    Y_pred = model.predict(X_val, batch_size=BATCH_SIZE)
    Y_pred_ids = np.argmax(Y_pred, axis=-1)

    # Per-type precision/recall (token-level, excluding PAD positions)
    for lab_id, lab_name in enumerate(label_list):
        if lab_name == "O":
            continue
        pred_mask = Y_pred_ids == lab_id
        true_mask = Y_val == lab_id
        # only count non-pad positions
        non_pad = X_val > 0
        pred_mask = pred_mask & non_pad
        true_mask = true_mask & non_pad
        tp = int(np.sum(pred_mask & true_mask))
        fp = int(np.sum(pred_mask & ~true_mask))
        fn = int(np.sum(~pred_mask & true_mask))
        prec = tp / (tp + fp) if (tp + fp) > 0 else 0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0
        print(f"  {lab_name:15s}  P={prec:.3f}  R={rec:.3f}  F1={f1:.3f}  (TP={tp} FP={fp} FN={fn})")

    # Save as HDF5 (compatible with tensorflowjs keras converter)
    model.save(str(MODEL_PATH))
    print(f"\nModel saved to {MODEL_PATH}")
    print(f"Vocab saved to {DATA_DIR / 'vocab.json'}")
    print(f"Labels saved to {DATA_DIR / 'labels.json'}")


if __name__ == "__main__":
    main()
