#pragma once
#include <string>
#include <format>
#include <vector>
#include <expected>
#include <cmath> // for std::ceil, std::floor
#include <cstdint> // for std::uint32_t
#include <utility> // for std::move
#include <algorithm> // for std::all_of
#include <cctype> // for std::isspace

namespace ACalcCore
{
	constexpr double 		DESIRED_PERCENTAGE 		= 85.0;
	constexpr double 		MIN_DESIRED_PERCENTAGE 	= 70.0;
	constexpr double 		MAX_DESIRED_PERCENTAGE 	= 90.0;
	constexpr std::uint32_t MAX_CLASSES				= 1000;

	inline std::string trim(const std::string& str) 
	{
	    auto start = std::find_if(str.begin(), str.end(), [](unsigned char ch) {
	        return !std::isspace(ch);
	    });
	
	    if (start == str.end()) {
	        return "";
	    }

	    auto end = std::find_if(str.rbegin(), str.rend(), [](unsigned char ch) {
	        return !std::isspace(ch);
	    }).base();

	    return std::string(start, end);
	}

	enum class ErrorCodes : std::uint8_t { 
		CCZ = 0, 	// Classes Conducted is Zero
		CAGCC,	 	// Classes Attended Greater than Classes Conducted
		ESN,	 	// Empty Subject Name
		SAP, 		// Subject Already Present
		SNP, 		// Subject Not Present
		IDP, 		// Invalid Desired Percentage
		CCTL, 		// Classes Count Too Large
	};
	
	struct Metrics
	{
		double requiredPercentage, excessPercentage;
		std::uint32_t classesNeeded, classesOverflow;
	};

	struct OperationResult
	{
		bool status{ false };
		ErrorCodes code{};
		std::string message{};
	};
	
	struct MetricsResult
	{
		bool status{ false };
		ErrorCodes code{};
		std::string message{};
		Metrics metrics{};
	};

	inline OperationResult validateSubjectName(const std::string& subjectName)
	{
		if (trim(subjectName).empty() || std::all_of(subjectName.begin(), subjectName.end(), [](unsigned char ch){ return std::isspace(ch); }))
		{
			return OperationResult{ false, ErrorCodes::ESN, "Subject Name cannot be Empty." };
		}

		return OperationResult{ true, {}, {} };
	}

	inline OperationResult validateDesiredPercentage(double value)
	{
		if (!(value <= MAX_DESIRED_PERCENTAGE && value >= MIN_DESIRED_PERCENTAGE))
		{
			return OperationResult{ false, ErrorCodes::IDP, std::format("Invalid Desired Percentage ({} %). Allowed Range: {} % - {} %", value, MIN_DESIRED_PERCENTAGE, MAX_DESIRED_PERCENTAGE) };
		}

		return OperationResult{ true, {}, {} };
	}

	inline OperationResult validateClassesCount(std::uint32_t classesAttended, std::uint32_t classesConducted)
	{
		if (classesConducted == 0)
		{
			return OperationResult{ false, ErrorCodes::CCZ, "Classes Conducted is Zero." };
		}
		
		if (classesAttended > MAX_CLASSES || classesConducted > MAX_CLASSES)
		{
			return OperationResult{ false, ErrorCodes::CCTL, std::format("Classes count is too large (> {}).", MAX_CLASSES) };
		}
		
		if (classesAttended > classesConducted)
		{
			return OperationResult{ false, ErrorCodes::CAGCC, std::format("Number of classes attended ({}) is more than the classes conducted ({}).", classesAttended, classesConducted) };
		}

		return OperationResult{ true, {}, {} };
	}

	class Subject
	{
	public:
		Subject() = delete;

		static std::expected<Subject, OperationResult> create(std::string subjectName, std::uint32_t classesAttended, std::uint32_t classesConducted, double desiredPercentage)
		{
			auto opResult = validateSubjectName(subjectName);
			if (!opResult.status)
			{
				return std::unexpected(opResult);
			}
			
			opResult = validateDesiredPercentage(desiredPercentage);
			if (!opResult.status)
			{
				return std::unexpected(opResult);
			}
			
			opResult = validateClassesCount(classesAttended, classesConducted);
			if (!opResult.status)
			{
				return std::unexpected(opResult);
			}

			return Subject(subjectName, classesAttended, classesConducted, desiredPercentage);
		}

	public:
		std::string subjectName() const
		{
			return m_subjectName;
		}

		std::uint32_t classesAttended() const
		{
			return m_CA;
		}

		std::uint32_t classesConducted() const
		{
			return m_CC;
		}

		double currentPercentage() const
		{
			return m_currentPercentage;
		}

		double requiredPercentage() const
		{
			return m_metrics.requiredPercentage;
		}

		double excessPercentage() const
		{
			return m_metrics.excessPercentage;
		}

		std::uint32_t classesNeeded() const
		{
			return m_metrics.classesNeeded;
		}

		std::uint32_t classOverflow() const
		{
			return m_metrics.classesOverflow;
		}

		Metrics metrics() const
		{
			return m_metrics;
		}

		std::expected<Metrics, OperationResult> metricsFor(double desiredPercentage) const
		{
			auto opResult = validateDesiredPercentage(desiredPercentage);
			if (!opResult.status)
			{
				return std::unexpected(opResult);
			}
			
			return metricsFor_impl(desiredPercentage);
		}

		std::expected<void, OperationResult> desiredPercentage(double value)
		{
			auto result = metricsFor(value);

			if (!result.has_value())
			{
				return std::unexpected(result.error());
			}

			m_metrics = result.value();

			return {};
		}

		std::expected<void, OperationResult> updateSubjectName(const std::string& subjectName)
		{
			auto opResult = validateSubjectName(subjectName);
			if (!opResult.status)
			{
				return std::unexpected(opResult);
			}
			
			m_subjectName = trim(subjectName);

			return {};
		}

		std::expected<void, OperationResult> updateCACC(std::uint32_t classesAttended, std::uint32_t classesConducted, double desiredPercentage)
		{
			auto opResult = validateClassesCount(classesAttended, classesConducted);
			if (!opResult.status)
			{
				return std::unexpected(opResult);
			}

			m_CA = classesAttended; m_CC = classesConducted;
			
			calculateCurrentPercentage();
			m_metrics = metricsFor_impl(desiredPercentage);

			return {};
		}

	private:
		Subject(std::string subjectName, std::uint32_t classesAttended, std::uint32_t classesConducted, double desiredPercentage) 
			: m_subjectName{ trim(subjectName) }, m_CA{ classesAttended }, m_CC{ classesConducted }
		{
			calculateCurrentPercentage();
			m_metrics = metricsFor_impl(desiredPercentage);
		}

		double calculateCurrentPercentage()
		{
			m_currentPercentage = static_cast<double>(m_CA) * 100.0 / m_CC;
			return m_currentPercentage;
		}

		Metrics metricsFor_impl(double desiredPercentage) const
		{
			Metrics m{};
			const double lhs = m_CA * 100.0, rhs = desiredPercentage * m_CC;

			if (lhs > rhs)
			{
				m.excessPercentage = m_currentPercentage - desiredPercentage;
				m.classesOverflow = static_cast<std::uint32_t>(std::floor((lhs) / desiredPercentage - m_CC));
			}
			else if (lhs < rhs)
			{
				m.requiredPercentage = desiredPercentage - m_currentPercentage;
				m.classesNeeded = static_cast<std::uint32_t>(std::ceil((rhs - lhs) / (100.0 - desiredPercentage)));
			}
			
			return m;
		}

	private:
		std::string m_subjectName;
		std::uint32_t m_CA, m_CC;
		double m_currentPercentage;
		
		Metrics m_metrics{};
	};

	class AttendanceRegister
	{
	public:
		OperationResult insert(const std::string& subjectName, std::uint32_t classesAttended, std::uint32_t classesConducted)
		{
			const std::string subName_trimmed = trim(subjectName);

			auto it = std::find_if(m_subjects.begin(), m_subjects.end(), [&](const Subject& subject) {
				return subject.subjectName() == subName_trimmed;
			});

			if (it != m_subjects.end())
			{
				return OperationResult{ false, ErrorCodes::SAP, std::format("Provided Subject ({}) is already present.", subName_trimmed) };
			}

			auto result = Subject::create(subName_trimmed, classesAttended, classesConducted, m_desiredPercentage);

			if (!result.has_value())
			{
				return result.error();
			}

			m_subjects.push_back(std::move(result.value()));

			return OperationResult{ true, {}, {} };
		}

		OperationResult edit(const std::string& subjectName, const std::string& subjectName_new, std::uint32_t classesAttended_new, std::uint32_t classesConducted_new)
		{
			const std::string subName_trimmed = trim(subjectName);
			const std::string subName_new_trimmed = trim(subjectName_new);

			auto it = std::find_if(m_subjects.begin(), m_subjects.end(), [&](const Subject& subject) {
				return subject.subjectName() == subName_trimmed;
			});

			if (it == m_subjects.end())
			{
				return OperationResult{ false, ErrorCodes::SNP, std::format("Provided Subject ({}) is not present.", subName_trimmed) };
			}

			const bool renaming = subName_trimmed != subName_new_trimmed;
			if (renaming)
			{
				auto opResult = validateSubjectName(subName_new_trimmed);
				if (!opResult.status)
				{
					return opResult;
				}
				
				auto _it = std::find_if(m_subjects.begin(), m_subjects.end(), [&](const Subject& subject) {
					return subject.subjectName() == subName_new_trimmed;
				});

				if (_it != m_subjects.end())
				{
					return OperationResult{ false, ErrorCodes::SAP, std::format("Provided Subject ({}) is already present.", subName_new_trimmed) };
				}
			}

			auto opResult = validateClassesCount(classesAttended_new, classesConducted_new);
			if (!opResult.status)
			{
				return opResult;
			}
			
			auto result = it->updateCACC(classesAttended_new, classesConducted_new, m_desiredPercentage);
			if (!result.has_value())
			{
				return result.error();
			}
			
			if (renaming)
			{
				result = it->updateSubjectName(subName_new_trimmed);
				if (!result.has_value())
				{
					return result.error();
				}
			}

			return OperationResult{ true, {}, {} };
		}
		
		OperationResult remove(const std::string& subjectName)
		{
			const std::string subName_trimmed = trim(subjectName);
			auto erasedCount = std::erase_if(m_subjects, [&](const Subject& subject){
				return subject.subjectName() == subName_trimmed;
			});
			
			if (erasedCount == 0)
			{
				return OperationResult{ false, ErrorCodes::SNP, std::format("Provided Subject ({}) is not present.", subName_trimmed) };
			}
			
			return OperationResult{ true, {}, {} };
		}

		void clear()
		{
			m_subjects.clear();
		}

		const std::vector<Subject>& subjects() const
		{
			return m_subjects;
		}

		MetricsResult metricsFor(const std::string& subjectName, double desiredPercentage) const
		{
			const std::string subName_trimmed = trim(subjectName);
			auto it = std::find_if(m_subjects.begin(), m_subjects.end(), [&](const Subject& subject) {
				return subject.subjectName() == subName_trimmed;
			});

			if (it == m_subjects.end())
			{
				return MetricsResult{ false, ErrorCodes::SNP, std::format("Provided Subject ({}) is not present.", subName_trimmed), {} };
			}

			auto result = it->metricsFor(desiredPercentage);
			if (!result.has_value())
			{
				return MetricsResult{ false, result.error().code, result.error().message, {} };
			}

			return MetricsResult{ true, {} , {}, result.value() };
		}

		OperationResult desiredPercentage(double value)
		{
			auto opResult = validateDesiredPercentage(value);
			if (!opResult.status)
			{
				return opResult;
			}
			
			m_desiredPercentage = value;

			for (auto& subject : m_subjects)
			{
				subject.desiredPercentage(value);
			}

			return OperationResult{ true, {}, {} };
		}

	private:
		std::vector<Subject> m_subjects;
		double m_desiredPercentage{ ACalcCore::DESIRED_PERCENTAGE };
	};
}