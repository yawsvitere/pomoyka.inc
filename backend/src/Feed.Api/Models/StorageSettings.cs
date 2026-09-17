namespace Feed.Api.Models;

public class StorageSettings
{
    public const int SingletonId = 1;
    public const long DefaultTotalQuotaBytes = 25L * 1024 * 1024 * 1024;
    public const long DefaultPerUserQuotaBytes = 1L * 1024 * 1024 * 1024;

    public int Id { get; set; } = SingletonId;
    public long TotalQuotaBytes { get; set; } = DefaultTotalQuotaBytes;
    public long DefaultUserQuotaBytes { get; set; } = DefaultPerUserQuotaBytes;

    public static long GetDefaultUserQuotaBytes(long totalQuotaBytes, int userCount)
    {
        if (userCount <= 0)
            return totalQuotaBytes;

        return Math.Max(1, totalQuotaBytes / userCount);
    }
}
