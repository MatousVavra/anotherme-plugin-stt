from conftest import load_plugin_module

# The sibling module, loaded through the plugin entrypoint exactly as deployed.
stt_names = load_plugin_module().stt_names


def test_build_name_prompt():
    people = [{"name": "Matouš Vávra", "pronunciation_hint": "MAT-oush VAV-rah"}]
    prompt = stt_names.build_name_prompt(people)
    assert "Matouš Vávra" in prompt
    assert "MAT-oush" in prompt


def test_correct_names():
    people = [{"name": "Matouš Vávra"}, {"name": "Praha"}]
    text, reps = stt_names.correct_names("I met Matous Vavra in Prague today.", people)
    assert "Matouš Vávra" in text
    assert any(r[1] == "Matouš Vávra" for r in reps)


def test_correct_names_no_false_positives():
    people = [{"name": "Anna"}]
    text, reps = stt_names.correct_names("I have an apple.", people)
    assert text == "I have an apple."
    assert reps == []


def test_correct_names_multiword():
    people = [{"name": "Matouš Vávra"}]
    text, reps = stt_names.correct_names("I met Matous Vavra in Prague today.", people)
    assert text == "I met Matouš Vávra in Prague today."
    assert any(r[1] == "Matouš Vávra" for r in reps)


def test_correct_names_multiword_already_correct():
    people = [{"name": "Matouš Vávra"}]
    text, reps = stt_names.correct_names("I met Matouš Vávra in Prague today.", people)
    assert text == "I met Matouš Vávra in Prague today."
    assert reps == []


def test_correct_names_multiword_anna():
    people = [{"name": "Anna Nováková"}]
    text, reps = stt_names.correct_names("I saw Anna Novakova yesterday.", people)
    assert text == "I saw Anna Nováková yesterday."
    assert any(r[1] == "Anna Nováková" for r in reps)


def test_correct_names_multiword_no_overlapping_replacement():
    people = [{"name": "Matouš Vávra"}]
    text, reps = stt_names.correct_names(
        "I met Matous Vavra and later Vavra left.", people
    )
    assert text == "I met Matouš Vávra and later Vavra left."
    assert len([r for r in reps if r[1] == "Matouš Vávra"]) == 1


def test_correct_names_prefers_longer_match():
    people = [{"name": "Anna"}, {"name": "Anna Nováková"}]
    text, reps = stt_names.correct_names("I saw Anna Novakova yesterday.", people)
    assert text == "I saw Anna Nováková yesterday."
    assert any(r[1] == "Anna Nováková" for r in reps)
    assert not any(r[1] == "Anna" for r in reps)


def test_correct_names_preserves_punctuation():
    people = [{"name": "Matouš Vávra"}]
    text, reps = stt_names.correct_names("I met Matous, Vavra today.", people)
    assert text == "I met Matouš, Vávra today."
    assert any(r[1] == "Matouš Vávra" for r in reps)


def test_correct_names_avoids_short_false_positives():
    people = [{"name": "Eva"}]
    text, reps = stt_names.correct_names("I see everyone every day.", people)
    assert text == "I see everyone every day."
    assert reps == []
