import { redirect } from "next/navigation";

// Old address from before the company page existed; sign-in links may still point here.
export default function OnboardingPage() {
  redirect("/company");
}
