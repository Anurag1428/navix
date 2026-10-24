/**
 * Candidate Profile & Master Source of Truth for Autonomous Application Workflows.
 *
 * Provides structured profile metadata, dynamic location resolution,
 * token-optimized macro summaries for planner navigation, and rich proof points
 * for rapid Micro-Brain (Qwen on Groq) text synthesis.
 */

export interface CandidateProofPoint {
    title: string
    domain: "agents_automation" | "computer_use_sandboxes" | "fullstack_multiplayer" | "frontend_general"
    summary: string
    keyMetrics: string
}

export interface CandidateProfileData {
    name: {
        first: string
        last: string
        full: string
        fallbackLastName: string
    }
    email: string
    phone: string
    urls: {
        github: string
        linkedin: string
        portfolio: string
        featuredRepo: string
    }
    location: {
        country: string
        defaultHub: string
        openToRemote: boolean
        openToRelocation: boolean
        requiresVisaForUS: boolean
    }
    education: {
        degree: string
        institution: string
        batch: string
        rule: string
    }
    availability: string
    salary: {
        text: string
        numeric: number
    }
    eeo: {
        gender: string
        disability: string
        veteran: string
    }
    techStack: {
        languagesAndFrontend: string[]
        backendAndDatabase: string[]
        agentsAndAutomation: string[]
        devOpsAndCloud: string[]
    }
    proofPoints: CandidateProofPoint[]
}

export const MASTER_CANDIDATE_PROFILE: CandidateProfileData = {
    name: {
        first: "Anurag",
        last: "Anurag",
        full: "Anurag",
        fallbackLastName: ".",
    },
    email: "anuurag.devv@gmail.com",
    phone: "+91 7275256535",
    urls: {
        github: "https://github.com/Anurag1428",
        linkedin: "https://www.linkedin.com/in/anurag-737795273/",
        portfolio: "https://starter-pack-iota.vercel.app/",
        featuredRepo: "https://github.com/Anurag1428/stack_overflow",
    },
    location: {
        country: "India",
        defaultHub: "Bengaluru, India",
        openToRemote: true,
        openToRelocation: true,
        requiresVisaForUS: true,
    },
    education: {
        degree: "B.Tech in Mechatronics and Automation Engineering",
        institution: "Indian Institute of Information Technology, Bhagalpur (IIIT Bhagalpur)",
        batch: "2022–2026",
        rule: "Do NOT mention GPA/CGPA in outreach messages or applications.",
    },
    availability: "Immediate joiner",
    salary: {
        text: "Flexible / Open to company standard",
        numeric: 0,
    },
    eeo: {
        gender: "Male",
        disability: "No",
        veteran: "I am not a protected veteran",
    },
    techStack: {
        languagesAndFrontend: [
            "TypeScript",
            "JavaScript",
            "React 19",
            "Next.js 15/16 (App Router)",
            "TanStack Query",
            "Redux",
            "React Flow (@xyflow/react)",
            "Liveblocks (@liveblocks/react-flow)",
            "Tailwind CSS 4",
            "Three.js",
            "React Three Fiber",
            "Base UI / shadcn",
        ],
        backendAndDatabase: [
            "Node.js",
            "Trigger.dev v4 (@trigger.dev/sdk, chat.agent, waitpoint tokens)",
            "Drizzle ORM",
            "Prisma",
            "tRPC",
            "Neon Serverless PostgreSQL",
            "MongoDB",
            "Redis",
            "Inngest",
            "Clerk Auth",
            "Better Auth",
        ],
        agentsAndAutomation: [
            "Stagehand v4 (@browserbasehq/stagehand)",
            "Playwright",
            "Browserbase SDK (HLS session replay proxy)",
            "Daytona Cloud Sandboxes (@daytona/sdk, XFCE4 GUI + noVNC)",
            "Vercel AI SDK v7 (@ai-sdk/google)",
            "Groq API (Qwen micro-brain)",
            "Airtable Metadata API",
        ],
        devOpsAndCloud: [
            "Docker",
            "AWS (EC2, ECR, EKS)",
            "DigitalOcean",
            "GitHub Actions",
            "Vercel",
            "Sentry",
            "Terraform",
            "Kubernetes",
        ],
    },
    proofPoints: [
        {
            title: "Navix (Autonomous Browser Agent & Multiplayer Canvas)",
            domain: "agents_automation",
            summary:
                "Built an autonomous browser agent and real-time multiplayer workflow platform with Next.js 16, React 19, Liveblocks, React Flow, Trigger.dev v4, Stagehand v4, Playwright, Browserbase (HLS session replay proxy), and Neon Postgres.",
            keyMetrics:
                "Dual-brain architecture pairing Gemini 2.5 Flash macro-planner with ~200ms Qwen micro-brain on Groq. Cut ~17,000 tokens per action via accessibility tree DOM pruning. Built 4-tier native DOM matcher (ARIA -> text -> SVG -> fallback) and zero-compute Trigger.dev waitpoint tokens for human-in-the-loop CAPTCHA/2FA pauses.",
        },
        {
            title: "Musketeers (Multi-Agent Computer-Use Platform with Dedicated Cloud Desktops)",
            domain: "computer_use_sandboxes",
            summary:
                "Gives autonomous bots their own isolated Daytona Linux sandboxes running an XFCE4 desktop GUI streamed live via 24-hour signed noVNC URLs, with transactional rollback on DB errors.",
            keyMetrics:
                "Equipped bots with 11 server-side sandbox tools (open_browser, multimodal view_screen, mouse/keyboard, bash, file I/O) plus multi-bot Group Chats with dynamic handoff routing (makeHandoffTool).",
        },
        {
            title: "Orcha & Multiplayer Workflow Canvases",
            domain: "fullstack_multiplayer",
            summary:
                "Engineered complex visual workflow automation platforms and personal AI agent SaaS using React Flow (@xyflow/react), Liveblocks collaborative state sync, tRPC, Prisma, Neon Postgres, and Inngest.",
            keyMetrics:
                "Production-grade multiplayer canvas synchronization, deterministic execution DAGs, and reactive UI state with sub-second feedback.",
        },
        {
            title: "Dev Overflow, Crisp & 3D Interactive Web",
            domain: "frontend_general",
            summary:
                "Shipped full-stack Q&A platform (Dev Overflow), Crisp AI interview assistant, and interactive 3D mythological-saga portfolio/browser game using Three.js and React Three Fiber.",
            keyMetrics:
                "Rich 3D rendering, fluid UI animations, and clean, accessible user experiences.",
        },
    ],
}

/**
 * Resolves candidate location dynamically to match the target job's location or hub.
 * Maximizes shortlisting probability by preventing city-mismatch filter disqualifications.
 */
export function resolveDynamicLocation(targetLocationText?: string): string {
    if (!targetLocationText || !targetLocationText.trim()) {
        return MASTER_CANDIDATE_PROFILE.location.defaultHub
    }

    const loc = targetLocationText.toLowerCase()

    // Match top Indian tech hubs if mentioned
    if (loc.includes("gurgaon") || loc.includes("gurugram")) {
        return "Gurgaon, India"
    }
    if (loc.includes("noida") || loc.includes("delhi") || loc.includes("ncr")) {
        return "Delhi NCR, India"
    }
    if (loc.includes("bengaluru") || loc.includes("bangalore")) {
        return "Bengaluru, India"
    }
    if (loc.includes("hyderabad")) {
        return "Hyderabad, India"
    }
    if (loc.includes("pune")) {
        return "Pune, India"
    }
    if (loc.includes("mumbai")) {
        return "Mumbai, India"
    }
    if (loc.includes("chennai")) {
        return "Chennai, India"
    }

    // Remote preferences
    if (loc.includes("remote")) {
        return "India (Open to Remote Worldwide)"
    }

    // US / Global roles: indicate open to relocation / remote
    if (loc.includes("united states") || loc.includes("usa") || loc.includes("san francisco") || loc.includes("new york")) {
        return "India (Open to US Relocation with Visa Sponsorship / Remote)"
    }

    return MASTER_CANDIDATE_PROFILE.location.defaultHub
}

/**
 * Lean candidate summary injected into the Gemini Macro planner prompt.
 * Keeps token overhead ultra-low (~80 tokens) while equipping the planner with
 * exact values for simple input fields (Name, Email, Phone, Location, URLs, Availability).
 */
export const DEFAULT_CANDIDATE_MACRO_SUMMARY = `
Candidate: ${MASTER_CANDIDATE_PROFILE.name.full} (First: "${MASTER_CANDIDATE_PROFILE.name.first}", Last: "${MASTER_CANDIDATE_PROFILE.name.last}" or "${MASTER_CANDIDATE_PROFILE.name.fallbackLastName}")
Email: ${MASTER_CANDIDATE_PROFILE.email} | Phone: ${MASTER_CANDIDATE_PROFILE.phone}
LinkedIn: ${MASTER_CANDIDATE_PROFILE.urls.linkedin} | Portfolio: ${MASTER_CANDIDATE_PROFILE.urls.portfolio} | GitHub: ${MASTER_CANDIDATE_PROFILE.urls.github}
Availability: ${MASTER_CANDIDATE_PROFILE.availability} | Desired Salary: "${MASTER_CANDIDATE_PROFILE.salary.text}" (or 0 if numeric)
Location Rule: Match target job location dynamically (e.g. Gurgaon for Gurgaon roles, Bengaluru for Bengaluru roles, or "Bengaluru, India" / "India (Remote)").
Work Auth: Authorized in India; open to remote worldwide or onsite India; requires US visa sponsorship for US relocation.
Education: ${MASTER_CANDIDATE_PROFILE.education.degree}, ${MASTER_CANDIDATE_PROFILE.education.institution} (${MASTER_CANDIDATE_PROFILE.education.batch}). Rule: NEVER mention GPA/CGPA.
EEO Defaults: Gender: ${MASTER_CANDIDATE_PROFILE.eeo.gender}, Disability: ${MASTER_CANDIDATE_PROFILE.eeo.disability}, Veteran: ${MASTER_CANDIDATE_PROFILE.eeo.veteran}.
FORM FILLING DIRECTIVE:
- For simple input fields (Name, Email, Phone, LinkedIn, GitHub, Portfolio, Location, Availability, Salary), type the above exact values directly.
- For open-ended questions ("Why should we hire you?", "Why this company?", "Note to founders", "Cover letter"), DO NOT write long essays yourself. Instead, use "formDelegation" to invoke the Micro-Brain (Qwen on Groq), which generates tailored proof points in ~200ms.
`.trim()

/**
 * Builds the focused proof-point context for the Micro-Brain (Qwen on Groq)
 * when answering essay and screening questions.
 */
export function buildCandidateContextForQwen({
    company,
    role,
    candidateProfileOverride,
}: {
    company?: string
    role?: string
    candidateProfileOverride?: string
}): string {
    if (candidateProfileOverride && candidateProfileOverride.trim()) {
        return candidateProfileOverride.trim()
    }

    const roleLower = (role || "").toLowerCase()
    const companyLower = (company || "").toLowerCase()

    // Select the best primary proof point based on the role and company domain
    let prioritizedPoints = MASTER_CANDIDATE_PROFILE.proofPoints

    if (
        roleLower.includes("browser") ||
        roleLower.includes("agent") ||
        roleLower.includes("automation") ||
        companyLower.includes("browser") ||
        companyLower.includes("stagehand")
    ) {
        // Prioritize Navix (browser automation & DOM pruning)
        prioritizedPoints = [
            MASTER_CANDIDATE_PROFILE.proofPoints[0],
            MASTER_CANDIDATE_PROFILE.proofPoints[1],
            MASTER_CANDIDATE_PROFILE.proofPoints[2],
        ]
    } else if (
        roleLower.includes("cloud") ||
        roleLower.includes("infra") ||
        roleLower.includes("sandbox") ||
        roleLower.includes("systems") ||
        companyLower.includes("daytona")
    ) {
        // Prioritize Musketeers (Daytona Linux sandboxes, noVNC)
        prioritizedPoints = [
            MASTER_CANDIDATE_PROFILE.proofPoints[1],
            MASTER_CANDIDATE_PROFILE.proofPoints[0],
            MASTER_CANDIDATE_PROFILE.proofPoints[2],
        ]
    } else if (
        roleLower.includes("frontend") ||
        roleLower.includes("react") ||
        roleLower.includes("ui") ||
        roleLower.includes("fullstack")
    ) {
        // Prioritize Liveblocks, React Flow, Next.js 16
        prioritizedPoints = [
            MASTER_CANDIDATE_PROFILE.proofPoints[2],
            MASTER_CANDIDATE_PROFILE.proofPoints[0],
            MASTER_CANDIDATE_PROFILE.proofPoints[3],
        ]
    }

    const proofBullets = prioritizedPoints
        .map((p) => `• ${p.title}: ${p.summary} Metrics/Proof: ${p.keyMetrics}`)
        .join("\n")

    return `
Candidate: ${MASTER_CANDIDATE_PROFILE.name.full}
Degree: ${MASTER_CANDIDATE_PROFILE.education.degree}, ${MASTER_CANDIDATE_PROFILE.education.institution} (${MASTER_CANDIDATE_PROFILE.education.batch})
Rule: NEVER mention GPA or CGPA.
Key Technical Achievements & Systems:
${proofBullets}
Availability: ${MASTER_CANDIDATE_PROFILE.availability}
`.trim()
}
