import { createSignUpView } from "@web-app-starter/auth-ui/views";
import { AppWaitlistForm } from "@/components/waitlist-form";

// App-owned questions; re-export SignUpView for the platform's email-only default.
export default createSignUpView({ waitlistForm: AppWaitlistForm });
