package ru.secreate.exchange;

import java.util.Objects;

/** Determines whether an incoming versioned external result may change local state. */
enum ResultDecision {
    APPLY, STALE, DUPLICATE, CONFLICT;

    static ResultDecision decide(long currentVersion, String currentResult,
                                 long incomingVersion, String incomingResult) {
        if (incomingVersion > currentVersion) return APPLY;
        if (incomingVersion < currentVersion) return STALE;
        return Objects.equals(currentResult, incomingResult) ? DUPLICATE : CONFLICT;
    }
}
