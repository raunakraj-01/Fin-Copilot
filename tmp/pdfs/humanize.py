from pathlib import Path
import html
import re
import pymupdf as fitz

source = Path(r'C:\Users\SATVIK\Downloads\IEEE research paper pbl.pdf')
out = Path(r'D:\el-sem-3\output\pdf\IEEE research paper pbl - humanized.pdf')
out.parent.mkdir(parents=True, exist_ok=True)

# Page and text-block locations refer to the original PDF. All graphics,
# equations, tables, references, headings and author details remain in place.
edits = {
(0,12): '''Abstract: This paper examines a student profile platform that combines assessment records and portfolio evidence in a React interface, an Express application, and a PostgreSQL academic ledger. Students, teachers, administrators, and placement staff use shared records, with role and assignment checks applied at selected server routes. The platform supports assessment trend analysis, credit-weighted academic history, evidence-backed candidate matching, and optional local language-model assistance. We trace the active execution path and evaluate numerical behavior with two repository unit tests and 16 supplementary function checks. All checks pass against their stated expectations. Constructed examples reproduce increasing, decreasing, and constant score trends and reveal differences in how services handle missing marks. A separate rubric example shows that the deterministic fallback can award half marks to unrelated nonempty text. The checks reproduce selected implementation behavior and identify validation needed before institutional use. The study does not measure learning outcomes, model accuracy, deployment latency, or security effectiveness.''',
(0,15): '''Academic records differ in meaning and authority. Teacher-entered marks contribute to an assessment ledger; uploaded marksheets may supply official grade-point values. Project descriptions record students' claims, while synchronized repositories provide external observations. Combining these records requires explicit rules for ownership, calculation, and evidence. Otherwise, a dashboard may present values together despite differences in their underlying assumptions.''',
(0,18): '''We examine whether records retain a clear meaning as they pass between services. Missing work, a recorded zero, and an unassessed submission need different treatment. An extrapolated score also carries different evidential weight from a verified academic result. These differences affect how users should interpret the platform's charts and recommendations.''',
(0,21): '''Baker and Yacef [1] traced the development of educational data mining as a field distinct from general data mining. They described a shift from summarizing student behaviour to prediction, clustering, and identifying relationships between variables. Romero and Ventura [2] reviewed the field again in 2020, documenting a wider range of tools, data sources, and applications. Both surveys examine what researchers can learn from academic data. They give less attention to whether a reported number retains the same meaning across the services that calculate and display it.''',
(0,22): '''Verbert et al. [3] compared learning analytics dashboards and the information they present to teachers and learners, including activity, time spent, and resource use. Charts can appear authoritative even when calculation choices, such as how missing marks are counted, remain hidden. Our results on pending assessments and denominators examine''',
(1,0): '''this difference between a displayed value and its calculation. The dashboard study [3] did not evaluate the consistency of individual calculations across services.''',
(1,2): '''Slade and Prinsloo [4] discuss consent, privacy, and the ethical risks of categorising students using partial data. Score extrapolation raises a related concern: readers may interpret a predicted value as a judgement about a student when it only extends a short numerical sequence. We therefore describe the regression output as a descriptive continuation of the supplied records.''',
(1,3): '''Hattie and Timperley [5] argue that useful feedback is specific to the task and helps learners decide what to do next; a bare score provides less guidance. Panadero and Jönsson [6] similarly find that the educational value of rubrics depends on their use, including feedback and self-assessment. A keyword-based fallback cannot provide this task-specific guidance or support self-assessment. The platform therefore stores suggested marks separately from reviewed marks, and we recommend that teachers retain responsibility for the final decision.''',
(1,5): '''Access control determines which records students, teachers, administrators, and placement staff may view. Sandhu et al. [7] described role-based access control, which assigns permissions to roles and assigns users to those roles. Ferraiolo et al. [8] later proposed a NIST standard model. Role membership identifies a user's category of permission, but access to a particular record also requires an object-level check. We report several routes where these checks are missing.''',
(1,6): '''Provenance records where data came from. Buneman et al. [9] distinguish why a value appears in a result from where it was copied. In a student profile, faculty-verified grades, synchronized repositories, and self-written project descriptions have different evidential weight. The interface should identify the source of each item so that users can assess it accordingly.''',
(1,8): '''Language-model output requires review.''',
(1,9): '''Kasneci et al. [10] discuss educational uses of language models and the need for fact checking and human oversight, since learners may place too much trust in fluent answers. Ji et al. [11] describe how generated text can read fluently while making claims unsupported by its source. The Qwen2.5 family [12] includes several sizes, among them a 3-billion-parameter model that can run on modest hardware. Local execution may suit institutions that prefer to keep student data out of external services. Smaller models have less capacity, so their output still needs careful checking before use.''',
(1,10): '''Kapoor and Narayanan [13] documented how data leakage inflated reported machine-learning performance across multiple fields. Our constructed examples establish function behavior without demonstrating predictive accuracy.''',
(1,12): '''Prior work often examines analytics methods, ethics, access control, provenance, and language models separately. Less attention has been given to their interaction in a working codebase and to consistency in the percentages reported by different services. We examine these questions through source tracing and executed function-level checks.''',
(1,15): '''The platform has a React and TypeScript presentation layer, an Express application layer, and PostgreSQL persistence. At startup, the backend initializes the academic database, schedules external-profile synchronization, and mounts six role-scoped API groups. It serves the interface through development middleware or an optimized production build. The evaluation follows the active application path and includes only components reachable during normal execution. Obsolete and unused modules are excluded from the findings.''',
(2,3): '''The intended record-level authorization sequence in Fig. 2 checks the token, role, assignment, and ownership before issuing a scoped query. A failed check returns an authorization error before data retrieval.''',
(2,5): '''Authorization coverage remains incomplete. The rubric-read, submission-read, and AI-marking handlers accept an assessment identifier without the assignment check used by the principal marks-entry route. These handlers need record-level authorization review in addition to their route-level role checks. The schema includes''',
(2,8): '''The application separates profile synchronization, academic computation, and optional generation. A failed synchronization should appear as unavailable, since it provides no evidence of student inactivity. Model availability is independent of ledger availability. The role intelligence engine has deterministic responses; some fallback paths report that local AI is unavailable. The interface can explain an absent narrative while retaining recorded academic facts.''',
(2,12): '''The marking service uses explicit statuses for absence and pending work. It stores null marks for several missing-work states and zero for the zero state. The batch save routine checks class membership and numeric bounds, then writes accepted entries in a database transaction. Application validation can reject individual rows while allowing accepted rows to commit. A database exception rolls back the transaction. The policy therefore permits partial acceptance during validation.''',
(2,14): '''The evidence service distinguishes self-reported information, externally retrieved records, and faculty-verified material. Verification and freshness fields accompany source links and descriptions of missing information. Reviewers can use these fields to assess the weight of each profile item. Recording the origin and derivation of data addresses the provenance concerns described by Buneman et al. [9].''',
(3,0): '''A match to a repository language or description describes an artifact; it does not establish the student's proficiency. The candidate matcher can use such a match to classify a requirement as DEMONSTRATED. This label records the outcome of the matching rule and remains subject to technical review of the underlying artifact.''',
(3,4): '''The analytics pipeline in Fig. 3 proceeds from mark entry through status and numeric validation to ledger storage. Missing-mark and weighting rules determine the statistics and trends displayed in role-scoped dashboards for teacher review.''',
(3,9): '''The academic service uses institutional grading rules when available and its embedded scale otherwise. Positive official marksheet values take precedence over calculated values. Aggregation sums obtained and maximum marks directly, without applying stored assessment weights.''',
(4,4): '''The teacher route orders individual students' marks by creation time. Cohort points use averages grouped by exam type in first-encounter order. The horizontal axis indexes records or milestones, not elapsed time. Trends may reflect assessment order, difficulty, or selection. Extrapolation therefore describes a continuation of the supplied sequence.''',
(4,6): '''The marking service builds a prompt from the submission, a teacher-defined rubric, and an optional answer key. The examined configuration uses Qwen2.5:3B locally through Ollama [12]. A usable response supplies suggestions for each criterion, capped at that criterion's maximum. The service inspects submitted code as text without executing it. Suggestions remain separate from reviewed marks and published feedback in the data model.''',
(4,11): '''The result is capped at 100. It is a rule-based alignment index with no measured interpretation as a hiring probability. The matcher allows an unknown CGPA to pass its CGPA condition. Institutions need an explicit policy for this case before using the result to shortlist candidates.''',
(4,16): '''Table II lists the checks. All supplementary checks match their declared expected outputs, including those designed to reproduce undesirable behavior. Passing these checks establishes agreement with selected function-level expectations; it does not establish how much of the application is correct. The evaluation excludes database constraints, middleware execution, browser behavior, live model output, and concurrent requests.''',
(4,28): '''These simple inputs produce perfect fits without estimating forecasting error. Predictive evaluation would require time-ordered held-out records, a defined target, and comparison with a simple baseline such as the most recent score. Separating students and assessment periods would help avoid leakage, which can inflate reported predictive performance [13].''',
(5,3): '''The denominator difference can change a student's apparent passing status before any language-model interpretation occurs. A separate check confirms that the class-subject service treats a recorded zero as an assessed result. As Table I shows, services can report different statistics under the same chart label.''',
(5,10): '''The implementation connects profiles, academic records, and candidate evidence through separate services and role-specific interfaces. Its deterministic methods can be reproduced. Official-value flags and evidence metadata let users inspect the basis of a result. The executed examples establish the behavior of selected functions under controlled inputs, including boundary cases that dashboard screenshots may conceal.''',
(5,12): '''The main priority is a common policy for pending work, absence, zero marks, and excused assessments. Services should state their populations, denominators, and weighting rules. A shared, tested aggregation policy would prevent percentages from changing solely because screens call different services. The default grade-boundary gap also needs correction.''',
(5,15): '''The student-generation path checks response length and a short list of suspicious strings before accepting model text. These checks do not establish factual grounding or resistance to prompt injection. The response field isGroundingVerified records an application assertion without independent validation. Numeric claims should be checked against retrieved records, and narrative quality assessed using a labeled task set. Educational language-model research recommends fact checking and human oversight [10]; fluent text can still contain unsupported claims [11].''',
(5,16): '''The rubric fallback's score floor can reward unrelated content. When qualitative evaluation is unavailable, a practical policy would leave it for teacher completion. The heuristic has not been validated as a grade. Candidate alignment also requires review of repository metadata and self-reported projects, while missing academic evidence needs an explicit eligibility status.''',
(6,0): '''oriented web application. Source tracing identifies active service boundaries and separates them from older repository implementations. Two existing unit tests and 16 supplementary checks reproduce selected numerical behavior. Trend calculations behave as expected for the constructed inputs, but the checks also expose inconsistencies: services use different denominators for pending marks, the default grading scale has an interval gap, and the rubric fallback awards at least half marks to nonempty answers. Reliable institutional decisions require a common academic policy, complete record-level authorization, and independent evaluation of generated text.''',
}

doc = fitz.open(source)
allblocks = [p.get_text('blocks') for p in doc]
log = []
for page_idx, page in enumerate(doc):
    selected = [(idx, text) for (p,idx),text in edits.items() if p == page_idx]
    for idx,text in selected:
        rect = fitz.Rect(allblocks[page_idx][idx][:4])
        page.add_redact_annot(rect, fill=(1,1,1))
    if selected:
        page.apply_redactions(images=0, graphics=0)
    for idx,text in selected:
        r = fitz.Rect(allblocks[page_idx][idx][:4])
        # Use the original column width and paragraph height.
        r.x0 = 49 if r.x0 < 100 else 312
        r.x1 = r.x0 + 253.5
        bold = (page_idx,idx) == (0,12)
        css = '''@font-face {font-family: Times; src:url(times.ttf);}
        @font-face {font-family: Times; src:url(timesbd.ttf); font-weight:bold;}
        * {margin:0; padding:0;} p {font-family:Times; font-size:9.96pt;
        line-height:11.5pt; text-align:justify; text-indent:10pt;}'''
        if bold:
            css += 'p {font-weight:bold; font-size:9pt; line-height:10.3pt;}'
        spare,scale = page.insert_htmlbox(r, '<p>'+html.escape(text)+'</p>', css=css,
                    archive=fitz.Archive(r'C:\Windows\Fonts'), scale_low=0)
        if spare < 0:
            raise RuntimeError(f'Text does not fit: page {page_idx+1}, block {idx}')
        log.append((page_idx+1,idx,round(scale,4),round(spare,2)))

doc.set_metadata({**doc.metadata, 'subject':'Prose revised for clarity and natural academic style'})
doc.save(out, garbage=4, deflate=True)
doc.close()
print(out)
print('Revised paragraphs:',len(edits))
print('Fit checks:',log)

check=fitz.open(out)
for i,p in enumerate(check):
    p.get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(str(out.parent / f'qa-{i+1}.png'))
print('Pages:',len(check))
print('Figures preserved:', [len(p.get_images()) for p in check])


