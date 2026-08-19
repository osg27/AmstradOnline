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
