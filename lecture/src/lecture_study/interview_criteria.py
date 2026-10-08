"""Supported interview dimensions and their distinct job-relevant evaluation scope."""

LABELS = {
    "domain_depth": "Domain Depth", "system_architecture": "System Architecture",
    "technical_communication": "Technical Communication",
    "customer_obsession": "Customer Obsession", "ownership": "Ownership",
    "invent_and_simplify": "Invent and Simplify", "are_right_a_lot": "Are Right, A Lot",
    "learn_and_be_curious": "Learn and Be Curious", "hire_and_develop_the_best": "Hire and Develop the Best",
    "insist_on_the_highest_standards": "Insist on the Highest Standards", "think_big": "Think Big",
    "bias_for_action": "Bias for Action", "frugality": "Frugality", "earn_trust": "Earn Trust",
    "dive_deep": "Dive Deep", "have_backbone_disagree_and_commit": "Have Backbone; Disagree and Commit",
    "deliver_results": "Deliver Results", "strive_to_be_earths_best_employer": "Strive to be Earth’s Best Employer",
    "success_and_scale_bring_broad_responsibility": "Success and Scale Bring Broad Responsibility",
}

CRITERION_GUIDE = {
    "domain_depth": "Evaluate correctness and depth of domain concepts, mechanisms, assumptions, methods and domain-specific tradeoffs that were actually probed. A material misconception on a claimed foundational method is direct negative evidence. Production deployment or end-to-end architecture is not a prerequisite for a Domain Depth rating unless the supplied role-specific criterion explicitly makes it relevant.",
    "system_architecture": "Evaluate system requirements, components and interfaces, scaling, reliability, failure handling and architectural tradeoffs that were actually probed. Do not substitute isolated algorithm knowledge for evidence about system design.",
    "technical_communication": """Evaluate effective communication with stakeholders, non-specialists, C-level executives,
partner departments and internal collaborators. Look for how the candidate identifies the audience's knowledge,
goals and concerns; selects the right level of detail, terminology, examples and format; translates technical
choices into business impact, risks and actionable options; listens, clarifies and checks shared understanding;
handles disagreement constructively; and makes decisions, responsibilities and follow-up actions clear.
Prefer concrete examples identifying the audience, the candidate's communication choices, feedback and outcome.
Observable interview explanations are evidence of those specific communication behaviors; reported project
interactions remain self-reported. Do not invent stakeholder success or infer it from a fluent interview answer.
Assess communication effectiveness, NOT Domain Depth or System Architecture. A failed algorithm question alone
is not a communication weakness; a technically strong answer alone is not communication strength. Technical
accuracy matters here when a specific communication example misleads its audience or obscures a decision.
Apply generic references to depth, reasoning and ownership to communication judgment and responsibility.
Do not score accent, native-language fluency, charisma, verbosity, executive exposure or job titles as competence.
Do not require every audience type to have been interviewed about. Unprobed communication situations are
coverage limitations, not capability failures. Only apply a resume gap to this criterion when the interview
actually probed a communication claim and showed a communication shortfall.""",
}

CRITERION_LEVEL_GUIDE = {
    "technical_communication": {
        "L4": "Clearly explain scoped work to teammates, ask clarifying questions, confirm understanding and communicate progress or blockers with support.",
        "L5": "Independently adapt explanations for technical and non-technical project stakeholders, clarify tradeoffs and risks, resolve misunderstandings and align next steps.",
        "L6": "Lead communication on ambiguous cross-functional work; tailor decision framing for executives and specialists, reconcile competing priorities and establish repeatable communication practices that sustain alignment.",
        "L7": "Shape communication around multi-team strategy and executive decisions; build durable alignment across organizations and mechanisms that help other leaders communicate complex choices effectively.",
    },
}
