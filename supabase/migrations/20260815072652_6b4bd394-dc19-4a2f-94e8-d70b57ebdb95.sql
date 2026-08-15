ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS patient_name TEXT,
  ADD COLUMN IF NOT EXISTS patient_age TEXT,
  ADD COLUMN IF NOT EXISTS patient_sex TEXT,
  ADD COLUMN IF NOT EXISTS patient_id_ref TEXT,
  ADD COLUMN IF NOT EXISTS referring_doctor TEXT;