module.exports = {
  canOpenURL: jest.fn().mockResolvedValue(false),
  openURL: jest.fn().mockResolvedValue(undefined),
  createURL: jest.fn((path) => `exp://localhost:8081/${path}`),
};
