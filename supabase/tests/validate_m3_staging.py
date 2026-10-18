"""Staging-only migration integration test. Always rolls back all baseline/test DDL.
Requires psycopg in the temporary client directory. No production .env is read.
"""
import os, sys, re, json
from pathlib import Path
from urllib.parse import urlsplit, unquote, parse_qs
sys.path.insert(0, os.path.join(os.environ['TEMP'], 'basa-eskwela-staging-client'))
import psycopg
from psycopg.types.json import Jsonb
ROOT = Path(__file__).resolve().parents[1]
REF = os.environ.get('BASA_ESKWELA_DISPOSABLE_PROJECT_REF', '')
if not re.fullmatch(r'[a-z]{20}', REF):
    raise RuntimeError('Configure a separate disposable Basa Eskwela project explicitly before running this validator')
PREFIX = 'fa310001-0000-4000-8000-'
def uid(n): return PREFIX + f'{n:012d}'
def sqlfile(name): return (ROOT / name).read_text(encoding='utf-8-sig')
def body(sql): return re.sub(r'^\s*(begin|commit)\s*;\s*$', '', sql, flags=re.I | re.M)
results = []
def record(name, detail='passed'):
    results.append({'test': name, 'result': detail})
    print('PASS:',name,detail)
def check(condition, name):
    if not condition: raise AssertionError(name)
    record(name)
def fail(c, name, query, params=None, state=None, fragment=None):
    c.execute('savepoint expected_failure')
    caught = None
    try:
        c.execute(query, params)
        c.execute('set constraints all immediate')
    except psycopg.Error as e:
        caught = (e.sqlstate, e.diag.message_primary or '')
    finally:
        c.execute('rollback to savepoint expected_failure')
        c.execute('release savepoint expected_failure')
    if not caught: raise AssertionError(name + ': unexpectedly succeeded')
    if state and caught[0] != state: raise AssertionError(name + ': unexpected SQLSTATE '+str(caught[0]))
    if fragment and fragment not in caught[1]: raise AssertionError(name + ': unexpected error')
    record(name, 'rejected '+str(caught[0]))
def claims(c, role):
    c.execute('reset role')
    number={'admin':1,'teacher':2,'student':3,'general_user':4}.get(role)
    token={'role':'authenticated','sub':uid(number)} if number else {'role':'anon'}
    c.execute("select set_config('request.jwt.claims',%s,true)", (json.dumps(token),))
    c.execute("select set_config('request.jwt.claim.sub',%s,true)", (token.get('sub',''),))
    c.execute("select set_config('request.jwt.claim.role',%s,true)", (token['role'],))
    c.execute('set local role '+('authenticated' if number else 'anon'))
def scalar(c, q, p=None): return c.execute(q,p).fetchone()[0]
def create(c,n,passages):
    return c.execute('select public.m3_create_collection_draft(%s,%s,%s,%s,%s)',(uid(n),'Collection',uid(10),'Easy',Jsonb(passages))).fetchone()[0]
def passage(n, **changes): return {'id':uid(n),'title':'Child','passageText':'Reviewed text','sourceMaterialId':None,**changes}

def run(c):
    check(not c.execute("select tablename from pg_tables where schemaname='public'").fetchall(), 'empty staging baseline')
    c.execute("set local statement_timeout='60s'")
    c.execute("set local lock_timeout='5s'")
    c.execute(sqlfile('tests/m3_staging_baseline.sql'))
    c.execute(body(sqlfile('m3_content_schema.sql')))
    c.execute(body(sqlfile('m3_content_rls.sql')))
    c.execute(body(sqlfile('m3_student_published_module_access.sql')))
    c.execute(sqlfile('tests/m3_passages_before.sql'))
    c.execute("insert into public.modules(id,title,path_id,difficulty,status,created_by,passage) values (%s,'No questions',%s,'Easy','draft',%s,'No question story'),(%s,'Blank draft',%s,'Easy','draft',%s,'')",(uid(13),uid(10),uid(1),uid(14),uid(10),uid(1)))
    c.execute("insert into public.uploaded_materials(id,uploaded_by,title,language,original_filename,storage_path,mime_type,file_size_bytes) values (%s,%s,'General source','en','general.pdf',%s,'application/pdf',100)",(uid(21),uid(4),f'{uid(4)}/{uid(21)}.pdf'))
    c.execute("insert into public.comprehension_questions(id,material_id,question_type,question_text,options,scaffolding_hint,review_status,reviewed_by) values (%s,%s,'literal','General question?','[\"One\",\"Two\",\"Three\",\"Four\"]','Read again.','reviewed',%s)",(uid(34),uid(21),uid(1)))
    c.execute("insert into public.comprehension_question_answers(question_id,correct_answer) values (%s,'One')",(uid(34),))
    c.execute('set constraints all immediate'); c.execute('set constraints all deferred')
    c.execute('drop table m3_before_questions,m3_before_answers,m3_before_modules')
    for table,short in [('comprehension_questions','questions'),('comprehension_question_answers','answers'),('modules','modules')]:
        c.execute(f'create temp table m3_before_{short} as select * from public.{table}')
    migration=body(sqlfile('m3_module_passages_phase1.sql'))
    c.execute('savepoint invalid_legacy')
    c.execute("update public.modules set passage='' where id=%s",(uid(12),))
    fail(c,'invalid legacy bank aborts migration',migration,fragment='Repair module question banks')
    check(scalar(c,"select to_regclass('public.module_passages') is null"),'failed migration leaves no passage table')
    c.execute('rollback to savepoint invalid_legacy');c.execute('release savepoint invalid_legacy')
    c.execute(migration)
    record('Phase 1 migration executed')
    check(scalar(c,"select count(*)=0 from public.modules m full join m3_before_modules b using(id) where to_jsonb(m) is distinct from to_jsonb(b)"),'module rows preserved exactly')
    check(scalar(c,"select count(*)=0 from public.comprehension_questions q full join m3_before_questions b using(id) where (to_jsonb(q)-'passage_id') is distinct from to_jsonb(b)"),'question IDs/content/metadata preserved exactly')
    check(scalar(c,"select count(*)=0 from public.comprehension_question_answers a full join m3_before_answers b using(question_id) where to_jsonb(a) is distinct from to_jsonb(b)"),'answer keys preserved exactly')
    check(scalar(c,"select count(*)=3 from public.module_passages"),'three nonblank legacy passages backfilled')
    check(scalar(c,"select count(*)=0 from public.module_passages p join public.modules m on m.id=p.module_id where md5(p.passage_text)<>md5(m.passage) or p.display_order<>1 or p.id<>m.id or p.created_at<>m.created_at or p.updated_at<>m.updated_at"),'passage hashes identities order timestamps preserved')
    check(scalar(c,"select count(*)=0 from public.comprehension_questions where (module_id is not null and passage_id is distinct from module_id) or (material_id is not null and passage_id is not null)"),'module and material question mappings correct')
    # Composite FK and ownership checks run as database owner to test constraints independently of grants.
    question="insert into public.comprehension_questions(module_id,material_id,passage_id,question_type,question_text,options,scaffolding_hint,display_order) values (%s,%s,%s,'literal','Bad link?','[\"A\",\"B\",\"C\",\"D\"]','Read.',99)"
    fail(c,'cross-module question reference',question,(uid(11),None,uid(12)),state='23503')
    fail(c,'material plus passage ownership',question,(None,uid(20),uid(11)),state='23514')
    fail(c,'passage module identity immutable','update public.module_passages set module_id=%s where id=%s',(uid(12),uid(11)),fragment='immutable')
    fail(c,'passage ID immutable','update public.module_passages set id=%s where id=%s',(uid(90),uid(11)),fragment='immutable')
    fail(c,'question passage identity immutable','update public.comprehension_questions set passage_id=%s where id=%s',(uid(12),uid(31)),fragment='immutable')
    fail(c,'duplicate passage order','insert into public.module_passages(module_id,title,display_order) values (%s,\'Duplicate\',1)',(uid(11),),state='23505')
    fail(c,'invalid source provenance','insert into public.module_passages(module_id,title,display_order,source_material_id) values (%s,\'Bad provenance\',2,%s)',(uid(11),uid(999)),state='23503')
    c.execute('savepoint provenance')
    c.execute("insert into public.uploaded_materials(id,uploaded_by,title,language,original_filename,storage_path,mime_type,file_size_bytes) values (%s,%s,'Isolated provenance','en','source.pdf',%s,'application/pdf',100)",(uid(22),uid(2),f'{uid(2)}/{uid(22)}.pdf'))
    c.execute('update public.module_passages set source_material_id=%s where id=%s',(uid(22),uid(11)))
    fail(c,'source deletion preserves activity','delete from public.uploaded_materials where id=%s',(uid(22),),state='23503')
    c.execute('rollback to savepoint provenance');c.execute('release savepoint provenance')
    role_matrix={}
    for role in ['anon','student','general_user','teacher','admin']:
        claims(c,role)
        if role=='anon':
            for table in ['modules','module_passages','comprehension_questions','comprehension_question_answers']:
                fail(c,'anonymous denied '+table,'select * from public.'+table,state='42501')
            role_matrix[role]={'all_reads':'denied'}
        else:
            counts=[scalar(c,'select count(*) from public.'+t) for t in ['modules','module_passages','comprehension_questions','comprehension_question_answers']]
            expected={'student':[1,1,1,0],'general_user':[1,1,2,0],'teacher':[1,1,2,1],'admin':[4,3,4,4]}[role]
            check(counts==expected,role+' read RLS '+str(counts))
            role_matrix[role]=dict(zip(['modules','passages','questions','keys'],counts))
        if role!='admin':
            fail(c,role+' cannot create collection','select public.m3_create_collection_draft(%s,\'Unauthorized\',%s,\'Easy\',\'[]\')',(uid(80),uid(10)),state='42501' if role=='anon' else 'P0001')
            fail(c,role+' cannot read readiness RPC','select public.m3_collection_publish_issues(%s)',(uid(11),),state='42501' if role=='anon' else 'P0001')
        if role=='anon':
            for operation in ["insert into public.modules(title) values ('Denied')", "update public.modules set title='Denied'", 'delete from public.modules']:
                fail(c,'anonymous module write denied',operation,state='42501')
        elif role!='admin':
            fail(c,role+' module creation denied',"insert into public.modules(title,path_id,difficulty,created_by,passage) values ('Denied',%s,'Easy',%s,'Text')",(uid(10),uid({'teacher':2,'student':3,'general_user':4}[role])),state='42501')
            fail(c,role+' cannot insert official questions',"insert into public.comprehension_questions(module_id,question_type,question_text,options,scaffolding_hint,display_order) values (%s,'literal','Denied?','[\"A\",\"B\",\"C\",\"D\"]','Read.',90)",(uid(11),),state='42501')
            check(c.execute("update public.comprehension_questions set question_text='Denied' where id=%s returning id",(uid(31),)).fetchall()==[],role+' cannot edit official questions')
            check(c.execute('delete from public.comprehension_questions where id=%s returning id',(uid(31),)).fetchall()==[],role+' cannot delete official questions')
            check(c.execute("update public.comprehension_question_answers set correct_answer='Two' where question_id=%s returning question_id",(uid(31),)).fetchall()==[],role+' cannot edit official answer keys')
            check(c.execute('delete from public.comprehension_question_answers where question_id=%s returning question_id',(uid(31),)).fetchall()==[],role+' cannot delete official answer keys')
        if role=='teacher':
            c.execute('savepoint teacher_review')
            check(len(c.execute("update public.comprehension_questions set question_text='Reviewed own material' where id=%s returning id",(uid(33),)).fetchall())==1,'Teacher retains own generated material review')
            check(len(c.execute("update public.comprehension_question_answers set correct_answer='Two' where question_id=%s returning question_id",(uid(33),)).fetchall())==1,'Teacher retains own generated material key review')
            c.execute('set constraints all immediate')
            c.execute('rollback to savepoint teacher_review'); c.execute('release savepoint teacher_review')
        if role=='general_user':
            check(c.execute("update public.comprehension_questions set question_text='Denied' where id=%s returning id",(uid(34),)).fetchall()==[],'General User cannot review own material questions')
        for operation in ["insert into public.module_passages(module_id,title,display_order) values ('"+uid(11)+"','Forbidden',2)","update public.module_passages set title='Forbidden'",'delete from public.module_passages']:
            fail(c,role+' direct passage write denied',operation,state='42501')
        if role not in ('anon','admin'):
            check(c.execute("update public.modules set title='Unauthorized' where id=%s returning id",(uid(11),)).fetchall()==[],role+' module update blocked')
            check(c.execute('delete from public.modules where id=%s returning id',(uid(11),)).fetchall()==[],role+' module delete blocked')
    claims(c,'admin')
    create(c,40,[passage(41)])
    check(scalar(c,'select count(*)=1 from public.module_passages where module_id=%s',(uid(40),)),'Admin creates single-passage draft')
    c.execute('savepoint admin_legacy_writes')
    check(len(c.execute("update public.modules set title='Admin edit' where id=%s returning id",(uid(12),)).fetchall())==1,'Admin retains module editing')
    check(len(c.execute('delete from public.modules where id=%s returning id',(uid(14),)).fetchall())==1,'Admin retains unused blank draft deletion')
    check(len(c.execute("update public.comprehension_questions set question_text='Admin review' where id=%s returning id",(uid(31),)).fetchall())==1,'Admin retains question review')
    c.execute('rollback to savepoint admin_legacy_writes');c.execute('release savepoint admin_legacy_writes')
    create(c,50,[passage(51),passage(52)])
    check(scalar(c,'select count(*)=2 from public.module_passages where module_id=%s',(uid(50),)),'Admin creates multi-passage draft')
    c.execute('savepoint admin_failure')
    fail(c,'failed child insert rolls back draft RPC','select public.m3_create_collection_draft(%s,\'Fail\',%s,\'Easy\',%s)',(uid(60),uid(10),Jsonb([passage(61),passage(61)])),state='23505')
    check(scalar(c,'select count(*)=0 from public.modules where id=%s',(uid(60),)),'no partial parent after child failure')
    check(scalar(c,'select count(*)=0 from public.module_passages where module_id=%s',(uid(60),)),'no partial children after child failure')
    c.execute('release savepoint admin_failure')
    create(c,70,[])
    fail(c,'zero-passage publication gate',"update public.modules set passage='Bypass',status='published' where id=%s",(uid(70),),fragment='Passage-aware learner delivery')
    fail(c,'multi-passage publication gate',"update public.modules set passage='Bypass',status='published' where id=%s",(uid(50),),fragment='Passage-aware learner delivery')
    c.execute('reset role')
    check(scalar(c,'select count(*)=0 from public.m3_pending_collection_delivery where module_id=%s',(uid(60),)),'failed draft leaves no rollout marker')
    c.execute('update public.module_passages set display_order=3-display_order where module_id=%s',(uid(50),))
    c.execute('set constraints all immediate')
    check(c.execute('select id,display_order from public.module_passages where module_id=%s order by display_order',(uid(50),)).fetchall()==[( __import__('uuid').UUID(uid(52)),1),(__import__('uuid').UUID(uid(51)),2)],'deferred unique order supports atomic swap')
    # Populate one complete bank as trusted fixture setup, then test Admin-only readiness.
    c.execute('set constraints all deferred')
    for i,category in enumerate(['literal','literal','inferential','inferential','critical','critical']):
        c.execute("insert into public.comprehension_questions(id,module_id,passage_id,question_type,question_text,options,scaffolding_hint,display_order,review_status,reviewed_by,generated_by_ai) values (%s,%s,%s,%s,'Ready?','[\"A\",\"B\",\"C\",\"D\"]','Read.',%s,'reviewed',%s,true)",(uid(100+i),uid(40),uid(41),category,i+1,uid(1)))
        c.execute("insert into public.comprehension_question_answers(question_id,correct_answer) values (%s,'A')",(uid(100+i),))
    c.execute('set constraints all immediate')
    claims(c,'admin')
    check(scalar(c,'select public.m3_collection_publish_issues(%s)',(uid(40),))==[],'complete six-question bank passes readiness')
    fail(c,'ready collection remains behind rollout gate',"update public.modules set status='published' where id=%s",(uid(40),),fragment='Passage-aware learner delivery')
    check(bool(scalar(c,'select public.m3_collection_publish_issues(%s)',(uid(70),))),'zero-passage readiness blocked')
    check(any('need review' in issue for issue in scalar(c,'select public.m3_collection_publish_issues(%s)',(uid(12),))),'generated bank readiness blocked')
    c.execute('savepoint missing_key')
    c.execute('delete from public.comprehension_question_answers where question_id=%s',(uid(100),))
    check(any('answer keys' in issue for issue in scalar(c,'select public.m3_collection_publish_issues(%s)',(uid(40),))),'missing key readiness blocked')
    c.execute('rollback to savepoint missing_key');c.execute('release savepoint missing_key')
    fail(c,'invalid answer key rejected',"update public.comprehension_question_answers set correct_answer='Not an option' where question_id=%s",(uid(100),),fragment='correct_answer must exactly match')
    print('ROLE_MATRIX:',json.dumps(role_matrix))
    return role_matrix

def main():
    values=[s.split('=',1)[1].strip().strip('\"\'') for s in Path(os.environ["BASA_ESKWELA_DISPOSABLE_ENV_FILE"]).read_text().splitlines() if s.strip().startswith('M3_DISPOSABLE_DATABASE_URL=')]
    if len(values)!=1: raise RuntimeError('Invalid private configuration')
    u=urlsplit(values[0])
    if not (u.scheme in ('postgres','postgresql') and (u.hostname==f'db.{REF}.supabase.co' or (u.hostname and u.hostname.endswith('.pooler.supabase.com') and unquote(u.username or '')==f'postgres.{REF}'))): raise RuntimeError('Staging target mismatch')
    if u.fragment or set(parse_qs(u.query)) - {'sslmode'}: raise RuntimeError('Unsupported connection options; target overrides are forbidden')
    c=None
    try:
        c=psycopg.connect(host=u.hostname, port=u.port or 5432, user=unquote(u.username or ''), password=unquote(u.password or ''), dbname=unquote(u.path.lstrip('/')), sslmode='require', connect_timeout=15)
        print('CONFIRMED_STAGING:',REF)
        matrix=run(c)
        from m3_phase2_checks import run_phase2
        run_phase2(c, globals())
        c.rollback()
        check(not c.execute("select tablename from pg_tables where schemaname='public'").fetchall(),'outer rollback leaves staging public schema empty')
        print('TOTAL_PASSED:',len(results))
        (ROOT/'tests'/'m3_staging_results.json').write_text(json.dumps({'project_ref':REF,'tests':results,'role_matrix':matrix,'rolled_back':True},indent=2))
    except Exception as e:
        # Never print a connection exception or complete SQL context.
        print('FAILED:',type(e).__name__,'SQLSTATE:',getattr(e,'sqlstate',None))
        if isinstance(e,psycopg.Error) and e.sqlstate:
            print('SQL_MESSAGE:',e.diag.message_primary)
        elif isinstance(e,AssertionError): print('ASSERTION:',str(e))
        return 1
    finally:
        if c: c.rollback();c.close()
    return 0
if __name__=='__main__': sys.exit(main())
