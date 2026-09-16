// Seed data only — used once to bootstrap the course store
// (src/lib/courseMappingStore.js) the first time it's empty. After that,
// courses are fully managed at runtime via the admin dashboard
// (src/routes/admin.js): ids, labels, and webinar URLs can all be added,
// renamed, or removed there without a code deploy or redeploy.
//
// `formValue` MUST exactly match one of the live options on the "Select
// the Course" dropdown (entry.2071464654) in the Google Form at the time
// of seeding — the admin dashboard enforces this same constraint on every
// future create/update by only offering a dropdown of the live options
// (fetched via src/lib/googleFormFields.js), never free text, so a typo
// can't silently break a course's form submissions.
export const SEED_COURSES = [
  {
    id: "java-fundamentals-spring-boot",
    label: "Java Fundamentals & Spring Boot",
    formValue: "Java",
    webinarUrl: "https://meetings.ccbp.in/mid/python-live-session",
  },
  {
    id: "static-responsive-website",
    label: "Build Your Own Static & Responsive Website",
    formValue: "Static Website",
    webinarUrl: "https://meetings.ccbp.in/mid/react-live-session",
  },
  {
    id: "programming-foundations",
    label: "Progamming Foundations",
    formValue: "Python",
    webinarUrl: "https://meetings.ccbp.in/mid/python-live-session",
  },
  {
    id: "intro-databases",
    label: "Introduction to Databases",
    formValue: "SQL",
    webinarUrl: "https://meetings.ccbp.in/mid/python-live-session",
  },
  {
    id: "dynamic-web-flexbox-js",
    label:
      "Build your own Dynamic Web Application, Responsive Web Design using Flexbox & JavaScript Essentials",
    formValue: "Dynamic Website",
    webinarUrl: "https://meetings.ccbp.in/mid/react-live-session",
  },
  {
    id: "developer-foundations-nodejs",
    label: "Developer Foundations and Node JS",
    formValue: "Node",
    webinarUrl: "https://meetings.ccbp.in/mid/react-live-session",
  },
  {
    id: "react-js-hooks",
    label: "React JS & React Hooks",
    formValue: "React",
    webinarUrl: "https://meetings.ccbp.in/mid/react-live-session",
  },
];
