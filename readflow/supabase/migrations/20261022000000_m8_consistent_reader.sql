-- Replacement for Perfect Score: 7 distinct verified reading days.
-- Run AFTER 20261019, 20261020 and 20261021 migrations.
BEGIN;
INSERT INTO public.m8_badges(id,name,description,icon)
VALUES ('consistent_reader','Consistent Reader','Read on 7 different days','CalendarCheck')
ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,icon=EXCLUDED.icon;
-- Keep existing awards safe if earlier versions were installed.
DELETE FROM public.m8_badges WHERE id='perfect_score'
  AND NOT EXISTS (SELECT 1 FROM public.m8_earned_badges WHERE badge_id='perfect_score');
CREATE OR REPLACE FUNCTION public.m8_award_consistent_reader()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF (SELECT count(*) FROM public.m8_reading_days WHERE user_id=NEW.user_id) >= 7 THEN
   INSERT INTO public.m8_earned_badges(user_id,badge_id)
   VALUES (NEW.user_id,'consistent_reader') ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.m8_award_consistent_reader() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS m8_consistent_reader_day ON public.m8_reading_days;
CREATE TRIGGER m8_consistent_reader_day AFTER INSERT ON public.m8_reading_days
FOR EACH ROW EXECUTE FUNCTION public.m8_award_consistent_reader();
INSERT INTO public.m8_earned_badges(user_id,badge_id)
SELECT user_id,'consistent_reader' FROM public.m8_reading_days
GROUP BY user_id HAVING count(*) >= 7 ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
