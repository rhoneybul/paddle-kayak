module.exports = {
  transform: {
    '^.+\\.jsx?$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|expo|@expo|@supabase|@react-native-async-storage)/)',
  ],
  moduleNameMapper: {
    '^react-native-svg$': '<rootDir>/src/__tests__/__mocks__/react-native-svg.js',
  },
  testEnvironment: 'node',
  testPathIgnorePatterns: [
    '/node_modules/',
    '/__mocks__/',
  ],
};
