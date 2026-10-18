"""Optional rollback-only DB checks after run_phase2; not run automatically.
Call run_publication(c, globals()) in the disposable staging harness before rollback.
Never use production. Existing Phase 1/2 tests intentionally test the old gate first.
"""


def run_publication(c, h):
    uid, scalar, check, fail, claims = (h[k] for k in ('uid', 'scalar', 'check', 'fail', 'claims'))
    c.execute('reset role')
    before = scalar(c, "select pg_get_functiondef('public.m3_collection_publish_issues(uuid)'::regprocedure)")
    c.execute(h['body'](h['sqlfile']('m3_enable_collection_publication.sql')))
    check(before == scalar(c, "select pg_get_functiondef('public.m3_collection_publish_issues(uuid)'::regprocedure)"), 'publication readiness unchanged')
    claims(c, 'admin')
    # Fixture 40/41 has six reviewed questions; fixture 50 is incomplete.
    fail(c, 'incomplete collection still blocked', "update public.modules set status='published' where id=%s", (uid(50),), fragment='Passage')
    c.execute('savepoint unreviewed')
    c.execute("update public.comprehension_questions set review_status='generated' where id=%s", (uid(100),))
    fail(c, 'unreviewed bank still blocked', "update public.modules set status='published' where id=%s", (uid(40),), fragment='need review')
    c.execute('rollback to savepoint unreviewed'); c.execute('release savepoint unreviewed')
    for category in ('literal', 'inferential', 'critical'):
        c.execute('savepoint missing_category')
        c.execute('delete from public.comprehension_questions where id=(select id from public.comprehension_questions where passage_id=%s and question_type=%s limit 1)', (uid(41), category))
        fail(c, 'exact two '+category+' retained', "update public.modules set status='published' where id=%s", (uid(40),), fragment='exactly two '+category)
        c.execute('rollback to savepoint missing_category'); c.execute('release savepoint missing_category')
    c.execute("update public.modules set passage=null where id=%s", (uid(40),))
    c.execute("update public.modules set status='published' where id=%s", (uid(40),))
    check(scalar(c, 'select passage=(select passage_text from public.module_passages where id=%s) and published_at is not null from public.modules where id=%s', (uid(41), uid(40))), 'valid collection publishes with legacy compatibility')
    for role in ('student', 'general_user'):
        claims(c, role)
        check(scalar(c, 'select count(*) from public.modules where id=%s', (uid(40),)) == 1, role+' sees published collection')
        check(scalar(c, 'select count(*) from public.module_passages where module_id=%s', (uid(40),)) == 1, role+' sees published passages')
        check(scalar(c, 'select count(*) from public.modules where id=%s', (uid(50),)) == 0, role+' cannot see draft')
        check(scalar(c, 'select count(*) from public.modules where id=%s', (uid(11),)) == 1, role+' retains legacy published access')
