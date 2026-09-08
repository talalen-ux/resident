import { Container } from "@/components/layout/Container";
import { Hero } from "@/components/landing/Hero";
import { Payout } from "@/components/landing/Payout";
import { Steps } from "@/components/landing/Steps";
import { Straight } from "@/components/landing/Straight";
import { ChainStrip } from "@/components/sections/ChainStrip";
import { SiteFooter } from "@/components/sections/SiteFooter";
import { SiteHeader } from "@/components/sections/SiteHeader";

/**
 * Four sections: what it does, how it works, how you get paid, and the
 * questions worth asking first. Everything longer lives at /docs.
 */
export default function Home() {
  return (
    <Container>
      <SiteHeader />
      <ChainStrip />
      <Hero />
      <Steps />
      <Payout />
      <Straight />
      <SiteFooter />
    </Container>
  );
}
