from app.api.routes import library_media


def test_indexed_box_art_uses_one_unique_longer_title(tmp_path, monkeypatch):
    monkeypatch.setattr(library_media, "MEDIA_ROOT", tmp_path)
    title_dir = tmp_path / "boxart" / "amiga" / "by-title"
    title_dir.mkdir(parents=True)
    expected = title_dir / "allo-allo-cartoon-fun.png"
    expected.write_bytes(b"cover")

    assert library_media._indexed_box_art("amiga", "AlloAllo_v1.zip", "Allo Allo") == expected


def test_indexed_box_art_rejects_ambiguous_longer_titles(tmp_path, monkeypatch):
    monkeypatch.setattr(library_media, "MEDIA_ROOT", tmp_path)
    title_dir = tmp_path / "boxart" / "amiga" / "by-title"
    title_dir.mkdir(parents=True)
    (title_dir / "alien-breed-special-edition.png").write_bytes(b"cover")
    (title_dir / "alien-breed-tower-assault.png").write_bytes(b"cover")

    assert library_media._indexed_box_art("amiga", "AlienBreed.zip", "Alien Breed") is None


def test_saved_art_is_found_by_title_from_a_differently_named_file(tmp_path, monkeypatch):
    monkeypatch.setattr(library_media, "MEDIA_ROOT", tmp_path)
    target = tmp_path / "boxart" / "cpc" / "abc123.png"
    target.parent.mkdir(parents=True)
    target.write_bytes(b"gryzor cover")

    library_media._index_box_art(target, "cpc", "Gryzor (Europe).dsk")
    library_media._index_box_art_title(target, "cpc", "Gryzor")

    found = library_media._indexed_box_art("cpc", "Gryzor (UK) [a].zip", "Gryzor")
    assert found is not None and found.read_bytes() == b"gryzor cover"


def test_title_index_never_replaces_existing_title_art(tmp_path, monkeypatch):
    monkeypatch.setattr(library_media, "MEDIA_ROOT", tmp_path)
    title_dir = tmp_path / "boxart" / "amiga" / "by-title"
    title_dir.mkdir(parents=True)
    curated = title_dir / "lemmings.png"
    curated.write_bytes(b"curated")
    download = tmp_path / "boxart" / "amiga" / "def456.jpg"
    download.write_bytes(b"other")

    library_media._index_box_art_title(download, "amiga", "Lemmings")

    assert curated.read_bytes() == b"curated"
    assert not (title_dir / "lemmings.jpg").exists()


def test_title_index_skips_blank_titles(tmp_path, monkeypatch):
    monkeypatch.setattr(library_media, "MEDIA_ROOT", tmp_path)
    download = tmp_path / "boxart" / "cpc" / "x.png"
    download.parent.mkdir(parents=True)
    download.write_bytes(b"x")

    library_media._index_box_art_title(download, "cpc", "  ")

    assert not (tmp_path / "boxart" / "cpc" / "by-title").exists()
