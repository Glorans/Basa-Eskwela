-- M3 preliminary content screen for learner-facing text (Capstone security hardening).   PROPOSED - NOT APPLIED TO STAGING
--
-- Adds ONE conservative screen, enforced in the database so every write path is covered: backend (service role),
-- direct Supabase writes by Teachers, School Admins, System Admins and Independent Learners, and the M3 RPCs.
-- Screened on every insert or change: reading-material titles and reading text (all formats: PDF, DOCX, JPG/PNG OCR,
-- typed or edited text), module titles and passages, passage-bank passages, questions, answer choices, hints, answer
-- keys, and private (Independent Learner) question sets. Also screened when a module is PUBLISHED (passage bank,
-- questions and answers included) and when a material or module is ASSIGNED to a classroom.
-- A flagged write is refused with HTTP 422 (PT422, hint CONTENT_SCREEN) and a message naming the categories and the
-- first line, never the matched words or personal details. There is no bypass switch.
-- This is a PRELIMINARY keyword/pattern screen, not a guarantee of safety, and it does not replace educator review.
-- Existing rows are NOT changed, deleted or rewritten; they are checked again when edited, published or assigned.
-- Term list: salted SHA-256 hashes of whole words / 2-3 word phrases (no plain terms in the repository).
-- Rollback: m3_content_screen_v1_ROLLBACK_PROPOSED.sql. Checks: ..._PREFLIGHT_READONLY.sql, ..._VERIFY_READONLY.sql.
-- Review of existing content (counts only): ..._EXISTING_CONTENT_REVIEW_READONLY.sql.

BEGIN;

DO $guard$
DECLARE
  missing text;
BEGIN
  IF to_regprocedure('public.content_screen_findings(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'M3 content screen already applied; nothing was changed';
  END IF;
  SELECT string_agg(t || '.' || c, ', ') INTO missing FROM (VALUES
    ('uploaded_materials', 'title'),
    ('uploaded_materials', 'content_text'),
    ('modules', 'title'),
    ('modules', 'passage'),
    ('module_passages', 'title'),
    ('module_passages', 'passage_text'),
    ('comprehension_questions', 'question_text'),
    ('comprehension_questions', 'options'),
    ('comprehension_questions', 'scaffolding_hint'),
    ('comprehension_question_answers', 'correct_answer'),
    ('comprehension_question_answers', 'answer_explanation'),
    ('comprehension_question_answers', 'supporting_evidence'),
    ('personal_material_question_sets', 'questions')
  ) x(t, c) WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = x.t AND column_name = x.c);
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'M3 content screen: expected columns missing (%); nothing was changed', missing; END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'content_screen' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'M3 content screen: a trigger named content_screen already exists; nothing was changed';
  END IF;
END $guard$;

-- Preliminary, conservative screen of learner-facing text. Returns only a category and the number of the first
-- non-empty line (paragraph) where it was found; never the matched words. Categories:
--   strong_language, sexual_content, hateful_language, self_harm_or_threat, graphic_violence  (salted SHA-256 term
--   list: whole words and 2-3 word phrases only, so ordinary words that merely contain a term never match);
--   personal_information (e-mail address, Philippine mobile number, 12-digit learner reference number);
--   web_link (any web address except official .gov.ph and .edu.ph sites).
CREATE FUNCTION public.content_screen_findings(p_text text)
RETURNS TABLE(category text, paragraph integer)
LANGUAGE plpgsql
IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $function$
declare
  terms constant text[] := array[
    'strong_language:76a39693e5943d007ff00827cc6c3dfd6b2ed7866f90b7166b0597ff7ce07d87',
    'strong_language:ccba75ca0cf4cee10765b8b1c4682011142e87e84951d4da3768b4d875b4996e',
    'strong_language:565c99260a7424284d8538fa48711c37183250cba8818c4e6683d8cd7266591d',
    'strong_language:fed43d5b2dee84826edb24ad17f1d80c54602ba30b72aa0f2936d1ed0b5d7a3e',
    'strong_language:b8b9391e0fe74909744c90ef9ec922bead0d1d96cac981072b5b071bf258391d',
    'strong_language:ee0dba8d29df8ee769018e5061904b7d8fe0c17711c08dbeb15381e1e4ee6a6e',
    'strong_language:4c8dc784a54ef69c9c4ccbf093402eb2ef975d455ee29dfd43a0aba4d4b81fe3',
    'strong_language:9b9c2f7aee24daf1eac47da19cb78a3d7e36ebfe16bb4dde4b0f03faa1a74e7f',
    'strong_language:68ea45b3d585114999766d7a9c9f89091af1e749fa2524589b70e79c573e3415',
    'strong_language:3e28f16d13b9726ef348d72d26d2354dd83b184648d8fdcb5a88e9ff649276fc',
    'strong_language:dbc565c4f5903d820b66689881b2a909154142313663a00d0a62d28fd40a4dc5',
    'strong_language:e462466f776b3d5a590a535c0285a19606589771f78b00d8d8611283735b8d71',
    'strong_language:b039f14c6aa2ec105ee75832c999fac8e5b11f7c9fae9aeb055d2e5aec3a20f5',
    'strong_language:e102cc140d43a2332f730f6723fcdc42ab6ca22c36346ea97b110035f0976a8f',
    'strong_language:00866fa3d272a10f5b686b28c977460d08f575c682f499d3dc7e439c16106dbe',
    'strong_language:22baddb57aab9ed43d8f5d81baf60769c8dc46517937ffc8ef97a610e9cec924',
    'strong_language:c83f92ff4a75d00d68baa2336bf6eaff83acf0baeeedb169ca3d6a27e9900678',
    'strong_language:43030ca5c666b502f45ab36c113c8f22b686e763b7c11def32ea16ed4092d8ae',
    'strong_language:03ccc1bea66faebbd4ca935b1161e25af736496287af53c9fd7ba37200323609',
    'strong_language:f597bed0f294d7d6fa32d99321465d3787e896898a0e6ac683c7f085fc2301f5',
    'strong_language:1160e0390238cf1a7611baa76e2fc79f4c9d698cbeecf7ad68d526f19bba6913',
    'strong_language:fbb1ff2439aac787cde16dd5bdb009f751a1452008e13e6fe80b76bfd5422577',
    'strong_language:4116d60634629bc264e675e9894e23e9a5a1062a73a746b0ce56b4b4885d3de1',
    'strong_language:bf0825e40f0226a5ccb094091cd72c8d16dd87ee1cf09c04ad863927e3a0d751',
    'strong_language:7cc95c3961de4719a22effea1e2c06b0f15249c94364a24f727bf8fbd54d67a5',
    'strong_language:157638e1975ee8fb0534e3fb97c14f9bd14573945acb7e2656e078d53f6478e7',
    'strong_language:ee5796891a66d32db513f50a7ea9f4517c656ff30239423f72333d9122446312',
    'strong_language:2e7a32e0db5d926b6df3cde325a0a2d19178be3ea0fa1e187b9b76fb8e56472d',
    'strong_language:05a9efada1661c3f818f052d11069814e6fd30c11d42be514b387ba2dabb8bcd',
    'strong_language:a6e81b8997d971d2b1ad6f34d637fc031775c1ddbfae88181b912717ae41745a',
    'strong_language:88b3f4887fd6c1505611536acd13548057f672e749fe6182fb7fcfd7bfa6001b',
    'sexual_content:eaebdbdf67ed3f300f63a1efe3865e3e33798bba7f6d6632281785d755f3effc',
    'sexual_content:6410e271fc7c78ea7efd7dc0ce0dbe71820aa2131bda4640a0cd7b24ce8400c4',
    'sexual_content:f97b5944e0048eebf703c73cb0928bcf053967c7aa4d62b7fab1add9c315d0e9',
    'sexual_content:41987e93435f2ce0e7094ea303d74f059be76cdb09e89ca43be80679fb0673a0',
    'sexual_content:35bf294fd0481ae79f22dfd92ffcb87bff9169ffe33bd77fa37b5a049b10ae10',
    'sexual_content:18da1e763f84fac0e0bc5c63db24f199f557d1ddeb4cf13dc56b0b6c101fd468',
    'sexual_content:21be58bc07fd922bc3875b4ac6e85bc4b1a12b1e68a7d2caef6fe72383f8544f',
    'sexual_content:be1cf2d925530a3a67da4315f12ac39cee0abf32c349d8f7390ae851ab2f3571',
    'sexual_content:34ca9e2c9235c1bd05f8a78023b45d1ede9d51096783e5c1d0ca3070c316174f',
    'sexual_content:95c19f1a852852f9a95be3a019ecbd2b588d2bde121745d8a19289f9898053bb',
    'sexual_content:fd2d202130a5dea07a46ce1b210553e911d1f86a88edcd180593babb09bb35bc',
    'sexual_content:1aabe21122aae50c9ecc401a48e1ab2555a137392dc42b93a2bdba1061706c9a',
    'sexual_content:43b3ed3ec886ad9e8e8750bc6e3bfead9c0589bb1191fe772535ab913fdb3a85',
    'sexual_content:65bb5f4e2897f1c6b4723c53177c3ccfb5c48d6036210421a1d51e2d5fb2b89c',
    'sexual_content:d8bf3f677db991d5c4a3ee188833fbd60bfefc9909e42b9a1284438e5c54174f',
    'sexual_content:92eecad5ef902bc919fad66c849d38a29f7be54ffffc965913083d689bdd6f00',
    'sexual_content:4ff158c4188987df3bdec15991ddf55f30cb2990ad18a0906f91316412442132',
    'sexual_content:adedc475e525965bb1061ef037858a998d2c868de85a12e229138431ef09e1f9',
    'sexual_content:04072434df2b9c4b77f938c90b5786e35ba46de8d0b38d490c0578fb4b52dd05',
    'sexual_content:c29308e5b4502ada52737b31120fbb5d2185324276b71eded976194a7e615a17',
    'sexual_content:a13d139310b5aea578ced95879254ec37840dc6b5b4d57d4f548439ed43ceba7',
    'sexual_content:974cb9709f89bf63586f4736b8b150fe580e9d2dda74b2b828a27aff8f45ef67',
    'sexual_content:5c2dd456ca8f4ec6aaba795c92940cce2c812a1962f6f1bcfb44d801bde1ee72',
    'sexual_content:7a97e6927bf9a9d0d8dfde9de21c1e1b1af09e3c801707108fb68fbd44793efd',
    'sexual_content:2a5d7610fe750a0d1c0165919a47c44f4556f883a8f192656c5352367d61fb52',
    'sexual_content:6b388c33b33b565bf12010c0b49d074688447c55a3ea68d7dcd1c592ddde993c',
    'hateful_language:b8d5a52cc29adf3d31e1be7b94187623a6d5e3cf6cc62d83146321078ebc538e',
    'hateful_language:7984956eda47581596e24af654506237f00b1539724815725e6a9432d50698dd',
    'hateful_language:577f6c6528223db6add9ea9ad5e76e49d468081103cfefea20c4ca3060041121',
    'hateful_language:2ba430992f8c0259873a997ad457b749d681d45559af965d0537d09044ef44b3',
    'hateful_language:b3ded03115a896457f7dabd82c9693430dc575ff55ecfb490c0d3c7f038fd142',
    'hateful_language:bebccb0a2ce5d3d592a45ce8c7a0c7e3d6af9fa4086507427132618e4cce1a1d',
    'hateful_language:612853404925f727c483e4f690db18c416cb1bbcbad265c807ad8f7b089283ee',
    'hateful_language:2ebe0c4d7f2fbad250ff7864c5d180ecff782c0d6949adc78b3302aab119cd08',
    'self_harm_or_threat:1a630417cf25ff51a188d493da7ebef017b549dcaf7507c924aa1ca26ff24bc6',
    'self_harm_or_threat:1c2d4188a90970ddf55dec384106a271c1f446d9675d88cc57eb038a1f9bdd40',
    'self_harm_or_threat:626422a7247ed12a681b28c5491492671ed199ca97fab08e7954b623a9f97644',
    'self_harm_or_threat:35de6e858050d1d8308fc2eef1fa65c43d726dd9e52994058a6e2feb8eec8a99',
    'self_harm_or_threat:c6453d57dc6495ab7fff68abe6de7c3415a509281855eeacc2a3f45d527eca35',
    'self_harm_or_threat:369cf446a0e77ef42489f9d57d7bd175ab3503326a24cd7929c46c72f32b31fc',
    'graphic_violence:7b53004b3ca9677f36280705013a30f66917862a7ad47be96757c6f0f1ea2b3c',
    'graphic_violence:02491fc5a0f65e2319d8edbdad04eba46c79af4129624e64c573c266aff28f8e',
    'graphic_violence:b7856450839183297db0f137f8b35d21d3a29b3b2de23182dc2da4872d295119',
    'graphic_violence:66dbf030a7a50a397476cec3872fd472d2ba87cea2fae0efe30a1997968ac6d3',
    'graphic_violence:8b527fa9684c68d6b8d8ea6caed27957ef7cd8abe9ae48aaddcbf804bc2f68bf'
  ];
  email constant text := '[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+';
  seen text[] := '{}';
  found text[];
  hashes text[];
  words text[];
  line text;
  prev text := '';
  chunk text;
  norm text;
  c text;
  n integer := 0;
begin
  if p_text is null or btrim(p_text) = '' then return; end if;
  for line in select x from regexp_split_to_table(p_text, '\r?\n') x loop
    continue when btrim(line) = '';
    n := n + 1;
    found := '{}';
    -- Each line is checked together with the previous one, so a phone number or phrase that wraps onto the next
    -- line (common in OCR and pasted text) is still found; a category is reported once, at its first line.
    chunk := prev || ' ' || line;
    prev := line;
    if chunk ~* email
       or chunk ~ '(^|[^0-9])(\+?63[ -]?|0)9[0-9]{2}[ -]?[0-9]{3}[ -]?[0-9]{4}([^0-9]|$)'
       or chunk ~ '(^|[^0-9])[0-9]{12}([^0-9]|$)' then
      found := found || 'personal_information'::text;
    end if;
    if exists (select 1 from regexp_matches(regexp_replace(chunk, email, ' ', 'gi'),
        '(?:https?://|www\.)([a-z0-9.-]+)|\m((?:[a-z0-9-]+\.)+(?:com|net|org|info|io|xyz|co|me|ly|gg|tv|app|site|online|ph))\M', 'gi') m
        where not lower(coalesce(m[1], m[2])) ~ '(^|\.)(gov|edu)\.ph\.?$') then
      found := found || 'web_link'::text;
    end if;
    norm := translate(lower(chunk), 'áàâäãéèêëíìîïóòôöõúùûüñç0134@$5', 'aaaaaeeeeiiiiooooouuuuncoieaass');
    select array_agg(t order by o) into words from regexp_split_to_table(norm, '[^a-z]+') with ordinality s(t, o) where t <> '';
    if words is not null then
      select array_agg(distinct encode(sha256(convert_to('basa-screen-v1:' || g, 'UTF8')), 'hex')) into hashes from (
        select w g from unnest(words) w
        union select regexp_replace(w, '(.)\1+', '\1', 'g') from unnest(words) w
        union select words[i] || ' ' || words[i + 1] from generate_subscripts(words, 1) i where i < array_length(words, 1)
        union select words[i] || ' ' || words[i + 1] || ' ' || words[i + 2] from generate_subscripts(words, 1) i where i < array_length(words, 1) - 1
      ) v;
      found := found || coalesce((select array_agg(distinct split_part(t, ':', 1)) from unnest(terms) t where split_part(t, ':', 2) = any(hashes)), '{}');
    end if;
    foreach c in array found loop
      if not c = any(seen) then
        seen := seen || c;
        category := c; paragraph := n;
        return next;
      end if;
    end loop;
  end loop;
end $function$;

-- String values of a JSON document (questions, choices, feedback), one per line.
CREATE FUNCTION public.content_screen_jsonb_text(p_value jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $function$
  select string_agg(v #>> '{}', E'\n') from jsonb_path_query(coalesce(p_value, 'null'::jsonb), 'strict $.**') v where jsonb_typeof(v) = 'string'
$function$;

-- Refuses learner-facing text that the screen flags: HTTP 422 through PostgREST (code PT422, hint CONTENT_SCREEN).
-- The message names categories and where they were first found, never the matched words or personal details.
CREATE FUNCTION public.content_screen_assert(p_kind text, p_action text, p_parts text[], p_texts text[])
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
declare
  labels constant jsonb := '{"strong_language": "strong language", "sexual_content": "sexual content",
    "hateful_language": "hateful language", "self_harm_or_threat": "self-harm or threats", "graphic_violence": "graphic violence",
    "personal_information": "personal information such as a phone number, e-mail address or ID number", "web_link": "a web link"}';
  cats text[] := '{}';
  first_part text;
  first_para integer;
  f record;
  i integer;
begin
  for i in 1 .. coalesce(array_length(p_texts, 1), 0) loop
    for f in select * from public.content_screen_findings(p_texts[i]) loop
      if not f.category = any(cats) then cats := cats || f.category; end if;
      if first_part is null then first_part := p_parts[i]; first_para := f.paragraph; end if;
    end loop;
  end loop;
  if array_length(cats, 1) is null then return; end if;
  raise exception using errcode = 'PT422', hint = 'CONTENT_SCREEN', detail = array_to_string(cats, ','),
    message = format('Content check: this %s may not be suitable for young learners (%s). It was first found in the %s%s. '
      || 'Please review and edit it before it is %s. This is an automatic preliminary check; please also review the content yourself.',
      p_kind, (select string_agg(labels ->> x, '; ') from unnest(cats) x), first_part,
      case when first_para > 1 then format(', line %s', first_para) else '' end, p_action);
end $function$;

CREATE FUNCTION public.content_screen_uploaded_material()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
begin
  if tg_op = 'INSERT' or new.title is distinct from old.title or new.content_text is distinct from old.content_text then
    perform public.content_screen_assert('reading material', 'saved', array['title', 'reading text'], array[new.title, new.content_text]);
  end if;
  return new;
end $function$;

CREATE FUNCTION public.content_screen_module_parts(p_module uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
  select array[
    (select string_agg(coalesce(p.title, '') || E'\n' || coalesce(p.passage_text, ''), E'\n') from public.module_passages p where p.module_id = p_module),
    (select string_agg(coalesce(q.question_text, '') || E'\n' || coalesce(public.content_screen_jsonb_text(q.options), '') || E'\n'
       || coalesce(q.scaffolding_hint, '') || E'\n' || coalesce(a.correct_answer, '') || E'\n' || coalesce(a.answer_explanation, '')
       || E'\n' || coalesce(a.supporting_evidence, ''), E'\n')
     from public.comprehension_questions q left join public.comprehension_question_answers a on a.question_id = q.id where q.module_id = p_module)]
$function$;

CREATE FUNCTION public.content_screen_module()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
declare
  changed boolean := tg_op = 'INSERT' or new.title is distinct from old.title or new.passage is distinct from old.passage;
  parts text[];
begin
  if new.status = 'published' and new.deleted_at is null
     and (tg_op = 'INSERT' or old.status is distinct from 'published' or old.deleted_at is not null or changed) then
    -- Publishing: everything learners will see (title, passage, passage bank, questions and answer keys).
    parts := public.content_screen_module_parts(new.id);
    perform public.content_screen_assert('reading module', 'published', array['title', 'passage', 'passage bank', 'questions or answers'],
      array[new.title, new.passage, parts[1], parts[2]]);
  elsif changed then
    perform public.content_screen_assert('reading module', 'saved', array['title', 'passage'], array[new.title, new.passage]);
  end if;
  return new;
end $function$;

CREATE FUNCTION public.content_screen_module_passage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
begin
  if tg_op = 'INSERT' or new.title is distinct from old.title or new.passage_text is distinct from old.passage_text then
    perform public.content_screen_assert('reading passage', 'saved', array['passage title', 'passage'], array[new.title, new.passage_text]);
  end if;
  return new;
end $function$;

CREATE FUNCTION public.content_screen_question()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
begin
  if tg_op = 'INSERT' or new.question_text is distinct from old.question_text or new.options is distinct from old.options
     or new.scaffolding_hint is distinct from old.scaffolding_hint then
    perform public.content_screen_assert('question', 'saved', array['question', 'answer choices', 'hint'],
      array[new.question_text, public.content_screen_jsonb_text(new.options), new.scaffolding_hint]);
  end if;
  return new;
end $function$;

CREATE FUNCTION public.content_screen_answer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
begin
  if tg_op = 'INSERT' or new.correct_answer is distinct from old.correct_answer or new.answer_explanation is distinct from old.answer_explanation
     or new.supporting_evidence is distinct from old.supporting_evidence then
    perform public.content_screen_assert('answer key', 'saved', array['answer', 'explanation', 'supporting evidence'],
      array[new.correct_answer, new.answer_explanation, new.supporting_evidence]);
  end if;
  return new;
end $function$;

CREATE FUNCTION public.content_screen_personal_questions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
begin
  if tg_op = 'INSERT' or new.questions is distinct from old.questions then
    perform public.content_screen_assert('question set', 'saved', array['questions'], array[public.content_screen_jsonb_text(new.questions)]);
  end if;
  return new;
end $function$;

-- Assigning: the material as learners will see it (also catches material saved before this check existed).
CREATE FUNCTION public.content_screen_material_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
begin
  perform public.content_screen_assert('reading material', 'assigned', array['title', 'reading text'],
    (select array[m.title, m.content_text] from public.uploaded_materials m where m.id = new.material_id));
  return new;
end $function$;

CREATE FUNCTION public.content_screen_module_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
declare parts text[] := public.content_screen_module_parts(new.module_id);
begin
  perform public.content_screen_assert('reading module', 'assigned', array['title', 'passage', 'passage bank', 'questions or answers'],
    (select array[m.title, m.passage, parts[1], parts[2]] from public.modules m where m.id = new.module_id));
  return new;
end $function$;

CREATE TRIGGER content_screen BEFORE INSERT OR UPDATE OF title, content_text ON public.uploaded_materials
  FOR EACH ROW EXECUTE FUNCTION public.content_screen_uploaded_material();
CREATE TRIGGER content_screen BEFORE INSERT OR UPDATE ON public.modules
  FOR EACH ROW EXECUTE FUNCTION public.content_screen_module();
CREATE TRIGGER content_screen BEFORE INSERT OR UPDATE OF title, passage_text ON public.module_passages
  FOR EACH ROW EXECUTE FUNCTION public.content_screen_module_passage();
CREATE TRIGGER content_screen BEFORE INSERT OR UPDATE OF question_text, options, scaffolding_hint ON public.comprehension_questions
  FOR EACH ROW EXECUTE FUNCTION public.content_screen_question();
CREATE TRIGGER content_screen BEFORE INSERT OR UPDATE OF correct_answer, answer_explanation, supporting_evidence ON public.comprehension_question_answers
  FOR EACH ROW EXECUTE FUNCTION public.content_screen_answer();
CREATE TRIGGER content_screen BEFORE INSERT OR UPDATE OF questions ON public.personal_material_question_sets
  FOR EACH ROW EXECUTE FUNCTION public.content_screen_personal_questions();
CREATE TRIGGER content_screen BEFORE INSERT ON public.reading_activity_assignments
  FOR EACH ROW EXECUTE FUNCTION public.content_screen_material_assignment();
CREATE TRIGGER content_screen BEFORE INSERT ON public.room_modules
  FOR EACH ROW EXECUTE FUNCTION public.content_screen_module_assignment();

REVOKE ALL ON FUNCTION public.content_screen_findings(text), public.content_screen_jsonb_text(jsonb),
  public.content_screen_assert(text, text, text[], text[]), public.content_screen_module_parts(uuid),
  public.content_screen_uploaded_material(), public.content_screen_module(), public.content_screen_module_passage(),
  public.content_screen_question(), public.content_screen_answer(), public.content_screen_personal_questions(),
  public.content_screen_material_assignment(), public.content_screen_module_assignment() FROM PUBLIC, anon, authenticated;
-- Signed-in authors may check their own draft text before saving (returns categories and line numbers only).
GRANT EXECUTE ON FUNCTION public.content_screen_findings(text) TO authenticated, service_role;

COMMIT;
