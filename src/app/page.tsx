import { Container } from "@/components/layout/Container";
import { Intro } from "@/components/landing/Intro";
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
    <>
      {/* The gate comes first so it leads the tab order: one Tab reaches its
          enter link. It is dismissed by a `:has()` rule keyed on #main, so DOM
          order is free — see globals.css. */}
      <Intro />
      <div id="main">
        <Container>
          <SiteHeader />
          <ChainStrip />
          <Hero />
          <Steps />
          <Payout />
          <Straight />
          <SiteFooter />
        </Container>
      </div>
    </>
  );
}
