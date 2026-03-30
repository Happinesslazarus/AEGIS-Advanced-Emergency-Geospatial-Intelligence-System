CREATE SEQUENCE IF NOT EXISTS report_num_seq START 1;

SELECT SETVAL('report_num_seq', COALESCE(
  (SELECT MAX(CAST(
    NULLIF(regexp_replace(report_number, '[^0-9]', '', 'g'), '') AS INTEGER
  )) FROM reports WHERE report_number ~ '^RPT-[0-9]+$'),
  0
) + 1, false);

CREATE OR REPLACE FUNCTION generate_report_number()
RETURNS TRIGGER AS $$
DECLARE
    next_num INTEGER;
BEGIN
    IF NEW.report_number IS NULL OR NEW.report_number = '' THEN
      next_num := NEXTVAL('report_num_seq');
      NEW.report_number := 'RPT-' || LPAD(next_num::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_report_number ON reports;
CREATE TRIGGER trg_report_number
  BEFORE INSERT ON reports
  FOR EACH ROW
  EXECUTE FUNCTION generate_report_number();
