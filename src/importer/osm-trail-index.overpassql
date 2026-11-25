[out:json][timeout:45];
(
  rel(59.5,19,70.2,32)["type"="route"]["route"~"^(hiking|foot)$"];
  // Routes represented in LIPAS. See the importing guide for their names.
  - rel(id:12110420,16799081,18528490,1983131,20190517,20190675);
);
out tags bb;
