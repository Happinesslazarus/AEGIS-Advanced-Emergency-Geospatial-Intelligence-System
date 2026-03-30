WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at) AS rn
  FROM reports
  WHERE report_number NOT SIMILAR TO 'RPT-[0-9]{4}'
)
UPDATE reports
SET report_number = 'RPT-' || LPAD(numbered.rn::TEXT, 4, '0')
FROM numbered
WHERE reports.id = numbered.id;

SELECT SETVAL('report_num_seq',
  COALESCE((SELECT MAX(CAST(SUBSTRING(report_number, 5) AS INTEGER)) FROM reports WHERE report_number ~ '^RPT-[0-9]+$'), 0) + 1,
  false);

SELECT id, report_number FROM reports ORDER BY report_number;
