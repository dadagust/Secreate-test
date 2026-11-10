package ru.secreate.exchange.emulator;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;

/** Stores local emulator fault controls separately from executed business operations. */
final class FaultModeStore {
    record Modes(boolean unavailable, boolean dropAfterSave, boolean duplicateResult, int delayMs) {}

    private FaultModeStore() {}

    static void initialize(Connection connection) throws SQLException {
        try (var statement = connection.createStatement()) {
            statement.execute("create table if not exists executor.fault_modes (singleton boolean primary key default true check(singleton), unavailable boolean not null default false, drop_after_save boolean not null default false, duplicate_result boolean not null default false, delay_ms integer not null default 0 check(delay_ms between 0 and 2500))");
            statement.execute("insert into executor.fault_modes(singleton) values (true) on conflict(singleton) do nothing");
        }
    }

    static Modes read(Connection connection, boolean lock) throws SQLException {
        String suffix = lock ? " for update" : "";
        try (var statement = connection.createStatement();
             ResultSet result = statement.executeQuery("select unavailable,drop_after_save,duplicate_result,delay_ms from executor.fault_modes where singleton=true" + suffix)) {
            if (!result.next()) throw new SQLException("Emulator fault control row is missing");
            return new Modes(result.getBoolean(1), result.getBoolean(2), result.getBoolean(3), result.getInt(4));
        }
    }

    static void enable(Connection connection, String mode, int delayMs) throws SQLException {
        try (var statement = connection.createStatement()) {
            statement.executeUpdate("update executor.fault_modes set unavailable=false,drop_after_save=false,duplicate_result=false,delay_ms=0 where singleton=true");
            String column = switch (mode) {
                case "unavailable" -> "unavailable";
                case "drop-after-save" -> "drop_after_save";
                case "duplicate-result" -> "duplicate_result";
                case "delayed-result" -> "delay_ms";
                default -> throw new IllegalArgumentException("Unknown fault mode");
            };
            String value = mode.equals("delayed-result") ? Integer.toString(delayMs) : "true";
            statement.executeUpdate("update executor.fault_modes set " + column + "=" + value + " where singleton=true");
        }
    }

    static void reset(Connection connection) throws SQLException {
        try (var statement = connection.createStatement()) {
            statement.executeUpdate("update executor.fault_modes set unavailable=false,drop_after_save=false,duplicate_result=false,delay_ms=0 where singleton=true");
        }
    }

    static void consumeOneShots(Connection connection) throws SQLException {
        try (var statement = connection.createStatement()) {
            statement.executeUpdate("update executor.fault_modes set drop_after_save=false,duplicate_result=false,delay_ms=0 where singleton=true");
        }
    }
}
