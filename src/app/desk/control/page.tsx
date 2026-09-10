import { Container } from "@/components/layout/Container";
import { Panel } from "@/components/desk/Panel";
import { ControlConsole } from "@/components/desk/ControlConsole";

export const metadata = {
  title: "Control",
  // Never indexed. It is the manual override on a desk that holds money.
  robots: { index: false, follow: false },
  description: "Manual control of the keeper, gated on a signature from the desk wallet.",
};

export const dynamic = "force-dynamic";

export default function ControlPage() {
  return (
    <Container className="flex flex-col gap-10 py-16">
      <header className="flex flex-col gap-3">
        <h1 className="type-h2 text-text-primary">Control</h1>
        <p className="type-body max-w-prose text-text-secondary">
          The rules run unattended. This is the way in when they should not:
          an opportunity the board has not priced, or a position that has become
          a risk to the treasury for a reason no price history contains.
        </p>
        <p className="type-body-sm max-w-prose text-text-secondary">
          Orders do not bypass anything. They become the same intents the rules
          emit, journalled before submission and reconciled after, and they take
          precedence: a position you have spoken for is not also acted on by a
          rule in the same tick.
        </p>
      </header>

      <Panel
        title="Desk wallet"
        hint="Only this wallet's signature is accepted"
      >
        <ControlConsole
          endpoint={process.env.NEXT_PUBLIC_KEEPER_URL ?? ""}
        />
      </Panel>
    </Container>
  );
}
