<?php
// ============================================================
//  LEGACY tour list  (pretend this was written in 2014)
//  GET /tours.php                 -> all tours
//  GET /tours.php?hospital=XYZ    -> tours for one hospital
//
//  Your job on Day 11: READ this file and trace exactly what it
//  does, then rebuild it in FastAPI without breaking its clients.
// ============================================================

header("Content-Type: application/json");

$db = new PDO("pgsql:host=db;port=5432;dbname=tourvault", "postgres", "postgres");

$sql = "SELECT id, hospital, title, status FROM tours";

if (isset($_GET['hospital']) && $_GET['hospital'] != "") {
    $sql = $sql . " WHERE hospital = '" . $_GET['hospital'] . "'";
}

$sql = $sql . " ORDER BY id";

$rows = $db->query($sql)->fetchAll(PDO::FETCH_ASSOC);

$out = array();
foreach ($rows as $r) {
    $item = array();
    $item['tour_id']       = (int)$r['id'];
    $item['hospital_name'] = $r['hospital'];
    $item['tour_title']    = strtoupper($r['title']);
    $item['is_published']  = ($r['status'] == "published") ? 1 : 0;
    $out[] = $item;
}

echo json_encode(array("count" => count($out), "tours" => $out));
