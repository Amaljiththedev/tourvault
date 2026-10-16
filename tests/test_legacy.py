"""Characterisation tests: the new /legacy/tours must behave exactly like the old PHP /tours.php.

These pin down the legacy CONTRACT (field names, formats, wrapper) that existing clients
depend on, so the migration can't silently change it.
"""

TOURS = [
    {"hospital": "Alder Hey", "title": "Entrance", "status": "published"},
    {"hospital": "Royal Liverpool", "title": "Outpatients", "status": "draft"},
]


def _seed(client, admin_headers):
    for t in TOURS:
        client.post("/tours", json=t, headers=admin_headers)


def test_legacy_shape_matches_php(client, admin_headers):
    _seed(client, admin_headers)

    body = client.get("/legacy/tours").json()

    assert body == {
        "count": 2,
        "tours": [
            {"tour_id": 1, "hospital_name": "Alder Hey", "tour_title": "ENTRANCE", "is_published": 1},
            {"tour_id": 2, "hospital_name": "Royal Liverpool", "tour_title": "OUTPATIENTS", "is_published": 0},
        ],
    }


def test_legacy_filter_by_hospital(client, admin_headers):
    _seed(client, admin_headers)

    body = client.get("/legacy/tours", params={"hospital": "Royal Liverpool"}).json()

    assert body["count"] == 1
    assert body["tours"][0]["hospital_name"] == "Royal Liverpool"


def test_legacy_injection_is_fixed(client, admin_headers):
    # The old PHP returned EVERY tour for this input. The new endpoint must not.
    _seed(client, admin_headers)

    body = client.get("/legacy/tours", params={"hospital": "x' OR '1'='1"}).json()

    assert body == {"count": 0, "tours": []}
