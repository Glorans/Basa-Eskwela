"""Disposable Supabase integration test; never reads production .env; always rolls back.
Uses the existing hard-allowlisted staging connection and synthetic baseline.
"""
import json, re, os
from pathlib import Path
from urllib.parse import urlsplit, unquote, parse_qs
from validate_m3_staging import (psycopg, Jsonb, ROOT, REF, uid, body, sqlfile,
    check, fail, scalar, claims, results)

def bank():
    return [dict(type=t, questionText=f"Question {i+1}?", options=["A","B","C","D"],
                 scaffoldingHint="Read again.", correctAnswer="A")
            for i,t in enumerate(["literal","literal","inferential","inferential","critical","critical"])]

def write(c, material, set_id=None, op="create", revision=None, questions=None, actor=None):
    return scalar(c, "select public.m3_write_material_question_set(%s,%s,%s,%s,%s,%s)",
                  (actor or uid(2), material, set_id, op, revision, Jsonb(questions if questions is not None else bank())))

def snapshot(c, set_id):
    return c.execute("select to_jsonb(q),to_jsonb(a) from public.comprehension_questions q join public.comprehension_question_answers a on a.question_id=q.id where q.question_set_id=%s order by q.display_order",(set_id,)).fetchall()

def run(c):
    check(not c.execute("select tablename from pg_tables where schemaname='public'").fetchall(), "empty disposable staging required")
    c.execute("set local statement_timeout='60s'")
    c.execute("set local lock_timeout='5s'")
    c.execute(sqlfile("tests/m3_staging_baseline.sql"))
    # The historical repository baseline contains two stray standalone tokens.
    # Strip those only in this synthetic test setup; production schema is not touched.
    baseline = re.sub(r"^\s*(s\.|\.)\s*$", "", sqlfile("m3_content_schema.sql"), flags=re.M)
    c.execute(body(baseline))
    c.execute(body(sqlfile("m3_content_rls.sql")))
    c.execute(body(sqlfile("m3_student_published_module_access.sql")))
    c.execute(sqlfile("tests/m3_passages_before.sql"))
    c.execute(body(sqlfile("m3_module_passages_phase1.sql")))
    c.execute(body(sqlfile("m3_module_passages_phase2.sql")))
    for i,t in enumerate(["literal","inferential","inferential","critical","critical"],2):
        qid=uid(100+i)
        c.execute("insert into public.comprehension_questions(id,material_id,question_type,question_text,options,scaffolding_hint,display_order,generated_by_ai,review_status,reviewed_by) values (%s,%s,%s,%s,'[\"One\",\"Two\",\"Three\",\"Four\"]','Hint',%s,true,'reviewed',%s)",(qid,uid(20),t,f"Existing {i}",i,uid(2)))
        c.execute("insert into public.comprehension_question_answers(question_id,correct_answer) values (%s,'One')",(qid,))
    c.execute("set constraints all immediate"); c.execute("set constraints all deferred")
    c.execute("create temp table sets_before_questions as select * from public.comprehension_questions")
    c.execute("create temp table sets_before_answers as select * from public.comprehension_question_answers")
    c.execute("create temp table sets_before_materials as select * from public.uploaded_materials")
    migration=body(sqlfile("m3_material_question_sets.sql"))
    c.execute("savepoint migration_rollback")
    c.execute(migration)
    check(scalar(c,"select count(*)=1 from public.material_question_sets"),"backfill creates one set")
    c.execute("rollback to savepoint migration_rollback"); c.execute("release savepoint migration_rollback")
    check(scalar(c,"select to_regclass('public.material_question_sets') is null"),"migration rollback removes new schema")
    check(scalar(c,"select count(*)=0 from public.comprehension_questions q full join sets_before_questions b using(id) where to_jsonb(q) is distinct from to_jsonb(b)"),"migration rollback preserves original questions")
    c.execute(migration)
    c.execute("savepoint safe_down")
    c.execute(body(sqlfile("m3_material_question_sets_rollback.sql")))
    check(scalar(c,"select to_regclass('public.material_question_sets') is null"),"unused migration explicit rollback succeeds")
    check(scalar(c,"select count(*)=0 from public.comprehension_questions q full join sets_before_questions b using(id) where to_jsonb(q) is distinct from to_jsonb(b)"),"explicit rollback preserves all original question records")
    c.execute("rollback to savepoint safe_down"); c.execute("release savepoint safe_down")
    check(scalar(c,"select count(*)=0 from public.comprehension_questions q full join sets_before_questions b using(id) where (to_jsonb(q)-'question_set_id') is distinct from to_jsonb(b)"),"backfill preserves every question ID/content/review/timestamp")
    check(scalar(c,"select count(*)=0 from public.comprehension_question_answers a full join sets_before_answers b using(question_id) where to_jsonb(a) is distinct from to_jsonb(b)"),"backfill preserves every answer key and timestamp")
    check(scalar(c,"select count(*)=0 from public.uploaded_materials m full join sets_before_materials b using(id) where (to_jsonb(m)-'next_question_set_number') is distinct from to_jsonb(b)"),"backfill preserves materials/ownership/timestamps")
    check(scalar(c,"select name='Question Set 1' and sequence_number=1 and created_by=%s from public.material_question_sets where material_id=%s",(uid(2),uid(20))),"Question Set 1 retains Teacher ownership")
    c.execute("set local role service_role")
    first=snapshot(c,uid(20))
    second=write(c,uid(20)); third=write(c,uid(20))
    c.execute("reset role")
    check(True,"trusted service role can execute atomic set persistence")
    fail(c,"explicit rollback refuses used sets without data loss",body(sqlfile("m3_material_question_sets_rollback.sql")),fragment="rollback refused")
    check(snapshot(c,uid(20))==first,"creating Sets 2 and 3 preserves Set 1 exactly")
    check(c.execute("select name from public.material_question_sets order by sequence_number").fetchall()==[("Question Set 1",),("Question Set 2",),("Question Set 3",)],"stable automatic numbering")
    for sid in [second,third]:
        check(c.execute("select question_type,count(*) from public.comprehension_questions where question_set_id=%s group by question_type order by question_type",(sid,)).fetchall()==[("critical",2),("inferential",2),("literal",2)],"new set has exact category distribution")
    third_before=snapshot(c,third)
    edited=bank()
    rows=snapshot(c,second)
    for draft,(q,a) in zip(edited,rows): draft["id"]=q["id"]
    edited[0]["questionText"]="Persisted edit to Set 2"
    edited[0]["options"][0]="Edited correct option"
    edited[0]["correctAnswer"]="D" # untrusted answer replacement must be ignored
    write(c,uid(20),second,"review",1,edited)
    second_after=snapshot(c,second)
    check(second_after[0][0]["question_text"]=="Persisted edit to Set 2","review persists selected edit")
    check([q["id"] for q,a in second_after]==[q["id"] for q,a in rows],"normal edits preserve question IDs")
    check(second_after[0][1]["correct_answer"]=="Edited correct option","review preserves correct option position and ignores client answer")
    check([a["created_at"] for q,a in rows]==[a["created_at"] for q,a in second_after],"review preserves answer-key records")
    check(snapshot(c,uid(20))==first and snapshot(c,third)==third_before,"editing Set 2 leaves Sets 1 and 3 untouched")
    write(c,uid(20),third,"regenerate",1)
    check(snapshot(c,third)!=third_before and snapshot(c,second)==second_after and snapshot(c,uid(20))==first,"regeneration replaces only Set 3")
    def rejected(name, actor=uid(2), material=uid(20), sid=None, op="create", rev=None, data=None, state=None):
        fail(c,name,"select public.m3_write_material_question_set(%s,%s,%s,%s,%s,%s)",
             (actor,material,sid,op,rev,Jsonb(bank() if data is None else data)),state=state)
    rejected("stale revision rejected",sid=second,op="review",rev=1,data=edited,state="40001")
    wrong=bank(); wrong[0]["type"]="critical"
    rejected("invalid distribution rejected",data=wrong,state="22023")
    broken=bank(); broken[-1]["correctAnswer"]="Missing"
    before=snapshot(c,third)
    rejected("failed regeneration rolls back old questions and keys",sid=third,op="regenerate",rev=2,data=broken)
    check(snapshot(c,third)==before,"failed regeneration is atomic")
    c.execute("insert into public.uploaded_materials(id,uploaded_by,title,language,original_filename,storage_path,mime_type,file_size_bytes) values (%s,%s,'Material B','en','b.pdf',%s,'application/pdf',100)",(uid(21),uid(2),f"{uid(2)}/{uid(21)}.pdf"))
    rejected("cross-material set denied",material=uid(21),sid=second,op="review",rev=2,data=edited,state="P0002")
    rejected("cross-set question IDs denied",sid=third,op="review",rev=2,data=edited,state="42501")
    rejected("learner write denied",actor=uid(3),state="42501")
    rejected("independent learner write denied",actor=uid(4),state="42501")
    rejected("Admin generation remains denied",actor=uid(1),state="42501")
    c.execute("insert into auth.users(id,email) values (%s,'other-teacher@example.invalid')",(uid(5),))
    c.execute("insert into public.profiles(id,role) values (%s,'teacher')",(uid(5),))
    rejected("other Teacher denied",actor=uid(5),state="42501")
    fail(c,"question set membership immutable","update public.comprehension_questions set question_set_id=%s where id=%s",(third,edited[0]["id"]))
    fail(c,"cross-material linkage constraint","insert into public.comprehension_questions(material_id,question_set_id,question_type,question_text,options,scaffolding_hint,display_order) values (%s,%s,'literal','Bad','[\"A\",\"B\",\"C\",\"D\"]','Hint',99)",(uid(21),second),state="23503")
    for role in ["student","general_user","teacher","admin"]:
        claims(c,role)
        expected=3 if role in ["teacher","admin"] else 0
        check(scalar(c,"select count(*) from public.material_question_sets")==expected,role+" set RLS")
        if role in ["student","general_user"]:
            check(scalar(c,"select count(*) from public.comprehension_question_answers")==0,role+" cannot retrieve any answer keys")
        fail(c,role+" cannot directly call trusted RPC","select public.m3_write_material_question_set(%s,%s,null,'create',null,%s)",(uid(2),uid(20),Jsonb(bank())),state="42501")
        c.execute("reset role")
    claims(c,"anon")
    fail(c,"anonymous cannot read sets","select * from public.material_question_sets",state="42501")
    c.execute("reset role")
    c.execute("select set_config('request.jwt.claims','{}',true)")
    c.execute("select set_config('request.jwt.claim.sub','',true)")
    write(c,uid(20),second,"review",2,edited,uid(1))
    check(scalar(c,"select count(*)=6 from public.comprehension_questions where question_set_id=%s and reviewed_by=%s",(second,uid(1))),"Admin retains review authorization")
    check(scalar(c,"select count(*)=0 from public.comprehension_questions q join sets_before_questions b using(id) where q.module_id is not null and (to_jsonb(q)-'question_set_id') is distinct from to_jsonb(b)"),"Admin module/passage banks unchanged")
    c.execute("set constraints all immediate")
    check(scalar(c,"select count(*)=0 from public.material_question_sets where material_id=%s",(uid(21),)),"Material B has no Material A sets")
    # Simulate a future deletion to prove the high-water mark never reuses numbers.
    c.execute("delete from public.comprehension_questions where question_set_id=%s",(third,))
    c.execute("delete from public.material_question_sets where id=%s",(third,))
    fourth=write(c,uid(20))
    check(scalar(c,"select name from public.material_question_sets where id=%s",(fourth,))=="Question Set 4","sequence never renames or reuses a deleted set number")

def main():
    values=[s.split("=",1)[1].strip().strip("\"'") for s in Path(os.environ["BASA_ESKWELA_DISPOSABLE_ENV_FILE"]).read_text().splitlines() if s.strip().startswith("M3_DISPOSABLE_DATABASE_URL=")]
    if len(values)!=1: raise RuntimeError("Invalid staging configuration")
    u=urlsplit(values[0])
    if not (u.scheme in ("postgres","postgresql") and (u.hostname==f"db.{REF}.supabase.co" or (u.hostname and u.hostname.endswith(".pooler.supabase.com") and unquote(u.username or "")==f"postgres.{REF}"))): raise RuntimeError("Staging target mismatch")
    if u.fragment or set(parse_qs(u.query))-{"sslmode"}: raise RuntimeError("Target overrides forbidden")
    c=None
    try:
        c=psycopg.connect(host=u.hostname,port=u.port or 5432,user=unquote(u.username or ""),password=unquote(u.password or ""),dbname=unquote(u.path.lstrip("/")),sslmode="require",connect_timeout=15)
        print("DISPOSABLE_STAGING:",REF)
        run(c)
        c.rollback()
        check(not c.execute("select tablename from pg_tables where schemaname='public'").fetchall(),"outer rollback leaves staging empty")
        print("TOTAL_PASSED:",len(results))
        (ROOT/"tests/m3_material_question_sets_results.json").write_text(json.dumps({"tests":results,"rolled_back":True,"project_ref":REF},indent=2))
        return 0
    except Exception as e:
        print("FAILED:",type(e).__name__,"SQLSTATE:",getattr(e,"sqlstate",None))
        if isinstance(e,psycopg.Error) and e.sqlstate: print("SQL_MESSAGE:",e.diag.message_primary)
        elif isinstance(e,AssertionError): print("ASSERTION:",str(e))
        return 1
    finally:
        if c: c.rollback(); c.close()
if __name__=="__main__": raise SystemExit(main())
