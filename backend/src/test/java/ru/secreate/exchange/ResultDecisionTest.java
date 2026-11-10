package ru.secreate.exchange;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class ResultDecisionTest {
    @Test
    void newerResultIsApplied() {
        assertEquals(ResultDecision.APPLY, ResultDecision.decide(2, "done", 3, "failed"));
    }

    @Test
    void staleResultDoesNotRollBackState() {
        assertEquals(ResultDecision.STALE, ResultDecision.decide(3, "done", 2, "failed"));
    }

    @Test
    void duplicateDoesNotChangeState() {
        assertEquals(ResultDecision.DUPLICATE, ResultDecision.decide(3, "done", 3, "done"));
    }

    @Test
    void conflictingSameVersionRequiresReview() {
        assertEquals(ResultDecision.CONFLICT, ResultDecision.decide(3, "done", 3, "failed"));
    }
}
