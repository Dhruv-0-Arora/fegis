"""
Synthetic PII dataset generator for training a word-level NER model.
Outputs train.json and val.json with BIO-tagged sentences.
"""

import json
import random
import string
from pathlib import Path
from faker import Faker

fake = Faker()
Faker.seed(42)
random.seed(42)

NUM_SAMPLES = 50_000
VAL_RATIO = 0.1
OUTPUT_DIR = Path(__file__).parent / "data"

BIO_LABELS = [
    "O",
    "B-NAME", "I-NAME",
    "B-EMAIL", "I-EMAIL",
    "B-PHONE", "I-PHONE",
    "B-FINANCIAL", "I-FINANCIAL",
    "B-SSN", "I-SSN",
    "B-ID", "I-ID",
    "B-ADDRESS", "I-ADDRESS",
    "B-SECRET", "I-SECRET",
]


def tag_span(words: list[str], labels: list[str], pii_type: str):
    """Apply BIO tags to the last len(words) entries of labels."""
    n = len(words)
    start = len(labels) - n
    labels[start] = f"B-{pii_type}"
    for i in range(start + 1, start + n):
        labels[i] = f"I-{pii_type}"


def random_filler() -> str:
    templates = [
        lambda: fake.sentence(nb_words=random.randint(3, 10)),
        lambda: fake.text(max_nb_chars=60),
        lambda: random.choice([
            "I need help with", "Can you check", "Please process",
            "Here is the info:", "My details are", "Update the record for",
            "The customer said", "According to the file",
            "Send this to", "Please forward to",
            "Contact information:", "Billing details below",
            "Hi, my password is", "The API key is",
            "I live at", "My social security number is",
            "Call me at", "Reach me on",
            "The account number is", "Credit card:",
        ]),
    ]
    return random.choice(templates)()


def gen_name() -> tuple[list[str], str]:
    if random.random() < 0.5:
        name = fake.name()
    else:
        name = f"{fake.first_name()} {fake.last_name()}"
    return name.split(), "NAME"


def gen_email() -> tuple[list[str], str]:
    return [fake.email()], "EMAIL"


def gen_phone() -> tuple[list[str], str]:
    formats = [
        lambda: fake.phone_number(),
        lambda: f"+1 {fake.msisdn()[3:6]}-{fake.msisdn()[6:9]}-{fake.msisdn()[9:13]}",
        lambda: f"({fake.msisdn()[3:6]}) {fake.msisdn()[6:9]}-{fake.msisdn()[9:13]}",
    ]
    phone = random.choice(formats)()
    return phone.split(), "PHONE"


def gen_ssn() -> tuple[list[str], str]:
    ssn = fake.ssn()
    return [ssn], "SSN"


def gen_credit_card() -> tuple[list[str], str]:
    cc = fake.credit_card_number()
    # sometimes add spaces
    if random.random() < 0.5 and len(cc) == 16:
        cc = f"{cc[:4]} {cc[4:8]} {cc[8:12]} {cc[12:]}"
    return cc.split(), "FINANCIAL"


def gen_address() -> tuple[list[str], str]:
    addr = fake.street_address()
    return addr.split(), "ADDRESS"


def gen_id_number() -> tuple[list[str], str]:
    patterns = [
        lambda: "".join(random.choices(string.ascii_uppercase, k=2)) + "".join(random.choices(string.digits, k=7)),
        lambda: fake.bothify("??#######").upper(),
        lambda: "".join(random.choices(string.ascii_uppercase + string.digits, k=9)),
    ]
    return [random.choice(patterns)()], "ID"


def gen_secret() -> tuple[list[str], str]:
    patterns = [
        lambda: fake.password(length=random.randint(8, 20)),
        lambda: f"sk-{''.join(random.choices(string.ascii_letters + string.digits, k=24))}",
        lambda: f"AKIA{''.join(random.choices(string.ascii_uppercase + string.digits, k=16))}",
        lambda: "".join(random.choices(string.ascii_letters + string.digits + "_-", k=random.randint(20, 40))),
    ]
    return [random.choice(patterns)()], "SECRET"


PII_GENERATORS = [gen_name, gen_email, gen_phone, gen_ssn, gen_credit_card, gen_address, gen_id_number, gen_secret]
PII_WEIGHTS = [25, 15, 15, 8, 10, 12, 7, 8]


def generate_sample() -> dict:
    words: list[str] = []
    labels: list[str] = []

    # how many PII spans to embed (1-3)
    num_pii = random.choices([1, 2, 3], weights=[50, 35, 15])[0]

    for i in range(num_pii + 1):  # filler-pii-filler-pii-...-filler
        # add filler
        filler = random_filler().split()
        words.extend(filler)
        labels.extend(["O"] * len(filler))

        if i < num_pii:
            gen = random.choices(PII_GENERATORS, weights=PII_WEIGHTS)[0]
            pii_words, pii_type = gen()
            words.extend(pii_words)
            labels.extend(["O"] * len(pii_words))
            tag_span(pii_words, labels, pii_type)

    # ~10% of samples are fully negative (no PII at all)
    if random.random() < 0.10:
        words = random_filler().split() + random_filler().split()
        labels = ["O"] * len(words)

    return {"words": words, "labels": labels}


def generate_negative_sample() -> dict:
    """Fully negative sample with no PII."""
    words = (random_filler() + " " + random_filler()).split()
    return {"words": words, "labels": ["O"] * len(words)}


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    samples = []
    for _ in range(NUM_SAMPLES):
        samples.append(generate_sample())

    # add extra negative samples (20% of total)
    for _ in range(NUM_SAMPLES // 5):
        samples.append(generate_negative_sample())

    random.shuffle(samples)

    # verify all labels are valid
    for s in samples:
        assert len(s["words"]) == len(s["labels"]), f"Mismatch: {len(s['words'])} words vs {len(s['labels'])} labels"
        for lab in s["labels"]:
            assert lab in BIO_LABELS, f"Unknown label: {lab}"

    split = int(len(samples) * (1 - VAL_RATIO))
    train_data = samples[:split]
    val_data = samples[split:]

    with open(OUTPUT_DIR / "train.json", "w") as f:
        json.dump(train_data, f)
    with open(OUTPUT_DIR / "val.json", "w") as f:
        json.dump(val_data, f)

    # also save the label list for later use
    with open(OUTPUT_DIR / "labels.json", "w") as f:
        json.dump(BIO_LABELS, f, indent=2)

    print(f"Generated {len(train_data)} training and {len(val_data)} validation samples")
    print(f"Saved to {OUTPUT_DIR}")

    # stats
    type_counts: dict[str, int] = {}
    for s in samples:
        for lab in s["labels"]:
            if lab.startswith("B-"):
                t = lab[2:]
                type_counts[t] = type_counts.get(t, 0) + 1
    print("PII span counts:", type_counts)


if __name__ == "__main__":
    main()
